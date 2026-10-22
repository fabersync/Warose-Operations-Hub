"use server";
import crypto from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth";
import { one, q, tx, type Query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { saveFile } from "@/lib/storage";
import { applyItemMap, findOrCreateSupplier, importEInvoice, itemKey, splitAmount, type ImportOutcome } from "@/lib/invoices";

export type FormState = { error?: string; ok?: string; results?: ImportOutcome[] };
const numv = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", "."); return s === "" ? null : Number(s); };
const idv = (v: FormDataEntryValue | null) => Number(v) || null;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function run(fn: (u: SessionUser) => Promise<string | void>): Promise<FormState> {
  try {
    const user = await requireUser("invoices");
    const ok = await fn(user);
    revalidatePath("/", "layout");
    return { ok: ok || undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ------------------------------ Import ------------------------------ */

export async function uploadEInvoices(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("invoices");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Alegeți fișierele XML sau ZIP descărcate din SPV." };
  const results: ImportOutcome[] = [];
  for (const f of files) results.push(await importEInvoice(Buffer.from(await f.arrayBuffer()), f.name, user.id));
  revalidatePath("/", "layout");
  return { results };
}

/** Factură introdusă manual (ex: bon fiscal, factură fără e-Factura), opțional cu PDF-ul atașat. */
export async function createManualInvoice(_: FormState, form: FormData): Promise<FormState> {
  let id = 0;
  const res = await run(async (user) => {
    const supplierId = idv(form.get("supplier_id"));
    const newName = String(form.get("supplier_name") ?? "").trim();
    const newCif = String(form.get("supplier_cif") ?? "").trim() || null;
    const number = String(form.get("number") ?? "").trim();
    const issueDate = String(form.get("issue_date") ?? "");
    const dueDate = String(form.get("due_date") ?? "") || null;
    const descs = form.getAll("description").map((v) => String(v).trim());
    const qtys = form.getAll("qty").map(numv);
    const units = form.getAll("unit").map((v) => String(v).trim() || null);
    const prices = form.getAll("unit_price").map(numv);
    const vats = form.getAll("vat_rate").map(numv);
    const lines = descs.map((d, i) => ({ d, qty: qtys[i], unit: units[i], price: prices[i], vat: vats[i] ?? 0 })).filter((l) => l.d);
    if (!supplierId && !newName) throw new Error("Alegeți furnizorul sau completați numele unui furnizor nou.");
    if (!number) throw new Error("Completați numărul facturii.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error("Completați data facturii.");
    if (!lines.length) throw new Error("Adăugați cel puțin o linie.");
    if (lines.some((l) => l.qty == null || l.price == null || !Number.isFinite(l.qty) || !Number.isFinite(l.price))) throw new Error("Fiecare linie are nevoie de cantitate și preț unitar fără TVA.");
    const pdf = form.get("pdf");
    let pdfPath: string | null = null;
    if (pdf instanceof File && pdf.size > 0) {
      const buf = Buffer.from(await pdf.arrayBuffer());
      const h = crypto.createHash("sha256").update(buf).digest("hex");
      pdfPath = await saveFile(`facturi/pdf/${h.slice(0, 2)}/${h}${path.extname(pdf.name).toLowerCase() || ".pdf"}`, buf);
    }
    id = await tx(async (tq) => {
      const sid = supplierId ?? (await findOrCreateSupplier(tq, newName, newCif));
      const dup = (await tq<{ id: number }>("SELECT id FROM invoices WHERE supplier_id=$1 AND upper(number)=upper($2) AND issue_date=$3 AND status <> 'cancelled'", [sid, number, issueDate]))[0];
      if (dup) throw new Error(`Factura ${number} din ${issueDate} de la acest furnizor există deja (#${dup.id}).`);
      const calc = lines.map((l) => { const net = r2(l.qty! * l.price!); return { ...l, net, vatAmt: r2((net * l.vat) / 100) }; });
      const net = r2(calc.reduce((s, l) => s + l.net, 0));
      const vat = r2(calc.reduce((s, l) => s + l.vatAmt, 0));
      const s = (await tq<{ default_category_id: number | null; default_rule_id: number | null; default_location_id: number | null }>(
        "SELECT default_category_id, default_rule_id, default_location_id FROM suppliers WHERE id=$1", [sid]))[0];
      const inv = (await tq<{ id: number }>(
        `INSERT INTO invoices (supplier_id, number, issue_date, due_date, total_net, total_vat, total_gross, source, pdf_path, category_id, rule_id,
                               allocation_location_id, receipt_location_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10,$11,(SELECT id FROM locations WHERE kind='production' AND active ORDER BY id LIMIT 1),$12) RETURNING id`,
        [sid, number, issueDate, dueDate, net, vat, r2(net + vat), pdfPath, s.default_category_id, s.default_rule_id, s.default_location_id, user.id]))[0];
      for (const [i, l] of calc.entries()) {
        await tq("INSERT INTO invoice_lines (invoice_id, line_no, description, qty, unit, unit_price, net, vat_rate, vat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [inv.id, i + 1, l.d, l.qty, l.unit, l.price, l.net, l.vat, l.vatAmt]);
      }
      await tq(
        `UPDATE invoice_lines l SET product_id = m.product_id, factor = m.factor, category_id = m.category_id,
                to_stock = coalesce((SELECT p.track_stock FROM products p WHERE p.id = m.product_id), false)
           FROM supplier_item_map m WHERE l.invoice_id = $1 AND m.supplier_id = $2
            AND m.item_key = 'desc:' || upper(regexp_replace(trim(l.description), '\\s+', ' ', 'g'))`, [inv.id, sid]);
      await audit({ userId: user.id, action: "invoice.create_manual", entity: "invoice", entityId: inv.id, details: { number, net, vat } }, tq);
      return inv.id;
    });
  });
  if (res.error) return res;
  redirect(`/facturi/${id}`);
}

/* --------------------------- Verificare --------------------------- */

async function saveDraftFields(tq: Query, id: number, form: FormData) {
  await tq(
    `UPDATE invoices SET category_id=$2, rule_id=$3, allocation_location_id=$4, receipt_location_id=$5, note=$6 WHERE id=$1`,
    [id, idv(form.get("category_id")), idv(form.get("rule_id")), idv(form.get("allocation_location_id")), idv(form.get("receipt_location_id")),
     String(form.get("note") ?? "").trim() || null],
  );
  const lineIds = form.getAll("line_id").map(Number);
  const products = form.getAll("product_id").map(idv);
  const factors = form.getAll("factor").map(numv);
  const cats = form.getAll("line_category_id").map(idv);
  const stock = new Set(form.getAll("to_stock").map(Number));
  for (const [i, lid] of lineIds.entries()) {
    const f = factors[i];
    if (f != null && (!Number.isFinite(f) || f <= 0)) throw new Error("Factorul de conversie trebuie să fie pozitiv.");
    await tq("UPDATE invoice_lines SET product_id=$3, factor=$4, category_id=$5, to_stock=$6 WHERE id=$1 AND invoice_id=$2",
      [lid, id, products[i], f ?? 1, cats[i], stock.has(lid) && products[i] != null]);
  }
}

export async function saveInvoice(_: FormState, form: FormData): Promise<FormState> {
  const verify = form.get("verify") === "1";
  return run(async (user) => {
    const id = Number(form.get("invoice_id"));
    await tx(async (tq) => {
      const inv = (await tq<{ status: string; supplier_id: number; supplier: string; number: string; issue_date: string; total_net: number; total_vat: number; rule_id: number | null;
        allocation_location_id: number | null; category_id: number | null; receipt_location_id: number | null }>(
        `SELECT i.status, i.supplier_id, s.name supplier, i.number, i.issue_date::text issue_date, i.total_net::float8 total_net, i.total_vat::float8 total_vat,
                i.rule_id, i.allocation_location_id, i.category_id, i.receipt_location_id
           FROM invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id=$1 FOR UPDATE OF i`, [id]))[0];
      if (!inv) throw new Error("Factura nu există.");
      if (inv.status !== "draft") throw new Error("Factura este deja verificată. Redeschideți-o pentru modificări.");
      await saveDraftFields(tq, id, form);
      if (!verify) return;

      const h = (await tq<typeof inv>(
        `SELECT i.status, i.supplier_id, s.name supplier, i.number, i.issue_date::text issue_date, i.total_net::float8 total_net, i.total_vat::float8 total_vat,
                i.rule_id, i.allocation_location_id, i.category_id, i.receipt_location_id
           FROM invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id=$1`, [id]))[0];
      const lines = await tq<{ id: number; description: string; supplier_code: string | null; qty: number; net: number; vat: number; product_id: number | null; factor: number; category_id: number | null; to_stock: boolean }>(
        `SELECT id, description, supplier_code, qty::float8 qty, net::float8 net, vat::float8 vat, product_id, factor::float8 factor, category_id, to_stock
           FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no`, [id]);

      // 1. Totalurile liniilor trebuie să corespundă documentului.
      const sumNet = r2(lines.reduce((s, l) => s + l.net, 0));
      if (Math.abs(sumNet - h.total_net) > 0.05) throw new Error(`Suma liniilor (${sumNet.toFixed(2)}) nu corespunde totalului fără TVA al facturii (${h.total_net.toFixed(2)}). Verificați documentul.`);
      // 2. Categoria și alocarea pe locații.
      if (lines.some((l) => !l.category_id) && !h.category_id) throw new Error("Alegeți categoria de cost (pentru factură sau pentru fiecare linie).");
      let splits: { location_id: number; pct: number }[];
      if (h.rule_id) splits = (await tq<{ splits: { location_id: number; pct: number }[] }>("SELECT splits FROM allocation_rules WHERE id=$1", [h.rule_id]))[0].splits;
      else if (h.allocation_location_id) splits = [{ location_id: h.allocation_location_id, pct: 100 }];
      else throw new Error("Alegeți locația sau regula de alocare a costului.");
      if (lines.some((l) => l.to_stock) && !h.receipt_location_id) throw new Error("Alegeți gestiunea în care intră marfa (recepție).");

      // 3. Costuri alocate pe locații și categorii.
      for (const l of lines) {
        for (const p of splitAmount(l.net, splits)) {
          if (p.amount === 0) continue;
          await tq(
            `INSERT INTO cost_entries (entry_date, location_id, category_id, amount_net, supplier, description, source, invoice_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'invoice',$7,$8)`,
            [h.issue_date, p.location_id, l.category_id ?? h.category_id, p.amount, h.supplier, `Factura ${h.number}: ${l.description}`, id, user.id]);
        }
        // 4. Prețul de achiziție pe unitatea de bază și memoria asocierii pentru facturile viitoare.
        if (l.product_id && l.qty) {
          await tq("INSERT INTO price_history (product_id, supplier_id, invoice_id, price_date, unit_cost) VALUES ($1,$2,$3,$4,$5)",
            [l.product_id, h.supplier_id, id, h.issue_date, Math.round((l.net / (l.qty * l.factor)) * 10000) / 10000]);
        }
        if (l.product_id || l.category_id) {
          await tq(
            `INSERT INTO supplier_item_map (supplier_id, item_key, product_id, factor, category_id) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (supplier_id, item_key) DO UPDATE SET product_id=$3, factor=$4, category_id=$5`,
            [h.supplier_id, itemKey(l.supplier_code, l.description), l.product_id, l.factor, l.category_id]);
        }
        // 5. Recepția în stoc (NIR operațional) pentru materiile prime cu stoc gestionat.
        if (l.to_stock && l.product_id) {
          await tq(
            `INSERT INTO stock_movements (location_id, product_id, qty, kind, document_ref, note, invoice_id, created_by)
             VALUES ($1,$2,$3,'receipt',$4,$5,$6,$7)`,
            [h.receipt_location_id, l.product_id, Math.round(l.qty * l.factor * 1000) / 1000, `Factura ${h.number}`, `Recepție ${h.supplier}`, id, user.id]);
        }
      }
      await tq(
        `UPDATE products p SET cost_price = x.unit_cost, cost_updated_at = now()
           FROM (SELECT DISTINCT ON (product_id) product_id, unit_cost FROM price_history ORDER BY product_id, price_date DESC, id DESC) x
          WHERE x.product_id = p.id AND p.id IN (SELECT product_id FROM invoice_lines WHERE invoice_id = $1 AND product_id IS NOT NULL)`, [id]);
      if (!(await tq("SELECT 1 FROM suppliers WHERE id=$1 AND default_category_id IS NOT NULL", [h.supplier_id])).length) {
        await tq("UPDATE suppliers SET default_category_id=$2, default_rule_id=$3, default_location_id=$4 WHERE id=$1",
          [h.supplier_id, h.category_id, h.rule_id, h.rule_id ? null : h.allocation_location_id]);
      }
      await tq("UPDATE invoices SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1", [id, user.id]);
      // Ce s-a învățat acum (asocieri, categorie, alocare) se aplică și celorlalte facturi neverificate ale furnizorului.
      const others = await tq<{ id: number }>(
        `UPDATE invoices i SET category_id = coalesce(i.category_id, s.default_category_id),
                rule_id = coalesce(i.rule_id, s.default_rule_id),
                allocation_location_id = CASE WHEN i.rule_id IS NULL AND s.default_rule_id IS NULL THEN coalesce(i.allocation_location_id, s.default_location_id) ELSE i.allocation_location_id END
           FROM suppliers s WHERE s.id = i.supplier_id AND i.supplier_id = $1 AND i.status = 'draft' AND i.id <> $2 RETURNING i.id`, [h.supplier_id, id]);
      for (const o of others) await applyItemMap(tq, o.id, h.supplier_id);
      await audit({ userId: user.id, action: "invoice.verify", entity: "invoice", entityId: id, details: { net: sumNet, splits } }, tq);
    });
    return verify ? "Factura a fost verificată: costurile au fost alocate, prețurile și stocul actualizate." : "Modificările au fost salvate.";
  });
}

/** Redeschiderea anulează efectele verificării (costuri, prețuri, recepții), păstrând istoricul în jurnal. */
export async function reopenInvoice(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("invoice_id"));
    await tx(async (tq) => {
      const inv = (await tq<{ status: string; saga: boolean }>("SELECT status, saga_registered_at IS NOT NULL saga FROM invoices WHERE id=$1 FOR UPDATE", [id]))[0];
      if (inv?.status !== "verified") throw new Error("Doar facturile verificate pot fi redeschise.");
      if (inv.saga) throw new Error("Factura este marcată ca înregistrată în SAGA. Anulați întâi marcajul.");
      const products = (await tq<{ product_id: number }>("SELECT DISTINCT product_id FROM price_history WHERE invoice_id=$1", [id])).map((r) => r.product_id);
      await tq("DELETE FROM cost_entries WHERE invoice_id=$1", [id]);
      await tq("DELETE FROM price_history WHERE invoice_id=$1", [id]);
      await tq(
        `UPDATE products p SET cost_price = (SELECT unit_cost FROM price_history h WHERE h.product_id = p.id ORDER BY price_date DESC, id DESC LIMIT 1)
          WHERE p.id = ANY($1::int[])`, [products]);
      const moves = await tq<{ id: number; location_id: number; product_id: number; qty: number }>(
        `SELECT m.id, m.location_id, m.product_id, m.qty::float8 qty FROM stock_movements m
          WHERE m.invoice_id = $1 AND m.kind = 'receipt' AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)`, [id]);
      for (const m of moves) {
        await tq("INSERT INTO stock_movements (location_id, product_id, qty, kind, reverses_id, note, invoice_id, created_by) VALUES ($1,$2,$3,'reversal',$4,$5,$6,$7)",
          [m.location_id, m.product_id, -m.qty, m.id, `Redeschidere factură #${id}`, id, user.id]);
      }
      await tq("UPDATE invoices SET status='draft', verified_by=NULL, verified_at=NULL WHERE id=$1", [id]);
      await audit({ userId: user.id, action: "invoice.reopen", entity: "invoice", entityId: id, details: { reversedMovements: moves.length } }, tq);
    });
    return "Factura a fost redeschisă; costurile, prețurile și recepția au fost anulate.";
  });
}

export async function cancelInvoice(_: FormState, form: FormData): Promise<FormState> {
  const res = await run(async (user) => {
    const id = Number(form.get("invoice_id"));
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) throw new Error("Indicați motivul anulării.");
    const r = await q("UPDATE invoices SET status='cancelled', note = coalesce(note || ' · ', '') || $2 WHERE id=$1 AND status='draft' RETURNING id", [id, `Anulată: ${reason}`]);
    if (!r.length) throw new Error("Doar facturile neverificate pot fi anulate.");
    await audit({ userId: user.id, action: "invoice.cancel", entity: "invoice", entityId: id, details: { reason } });
  });
  if (res.error) return res;
  redirect("/facturi");
}

export async function markSaga(form: FormData) {
  const user = await requireUser("invoices");
  const id = Number(form.get("invoice_id"));
  const undo = form.get("undo") === "1";
  const note = String(form.get("saga_note") ?? "").trim() || null;
  await q(undo
    ? "UPDATE invoices SET saga_registered_at=NULL, saga_registered_by=NULL, saga_note=NULL WHERE id=$1"
    : "UPDATE invoices SET saga_registered_at=now(), saga_registered_by=$2, saga_note=$3 WHERE id=$1 AND status='verified'",
    undo ? [id] : [id, user.id, note]);
  await audit({ userId: user.id, action: undo ? "invoice.saga_unmark" : "invoice.saga_registered", entity: "invoice", entityId: id, details: { note } });
  revalidatePath("/facturi", "layout");
}

/* ----------------------------- Costuri ----------------------------- */

export async function addCostEntry(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const date = String(form.get("entry_date") ?? "");
    const categoryId = idv(form.get("category_id"));
    const amount = numv(form.get("amount_net"));
    const ruleId = idv(form.get("rule_id"));
    const locationId = idv(form.get("location_id"));
    const supplier = String(form.get("supplier") ?? "").trim() || null;
    const description = String(form.get("description") ?? "").trim() || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Alegeți data.");
    if (!categoryId) throw new Error("Alegeți categoria.");
    if (amount == null || !Number.isFinite(amount) || amount === 0) throw new Error("Completați suma fără TVA.");
    const splits = ruleId
      ? (await one<{ splits: { location_id: number; pct: number }[] }>("SELECT splits FROM allocation_rules WHERE id=$1", [ruleId]))!.splits
      : locationId ? [{ location_id: locationId, pct: 100 }] : null;
    if (!splits) throw new Error("Alegeți locația sau regula de alocare.");
    await tx(async (tq) => {
      for (const p of splitAmount(amount, splits)) {
        await tq(`INSERT INTO cost_entries (entry_date, location_id, category_id, amount_net, supplier, description, source, created_by)
                  VALUES ($1,$2,$3,$4,$5,$6,'manual',$7)`, [date, p.location_id, categoryId, p.amount, supplier, description, user.id]);
      }
      await audit({ userId: user.id, action: "cost.add", details: { date, categoryId, amount, splits, supplier, description } }, tq);
    });
    return "Costul a fost adăugat.";
  });
}

export async function deleteCostEntry(form: FormData) {
  const user = await requireUser("invoices");
  const id = Number(form.get("entry_id"));
  const r = await q<{ amount_net: string }>("DELETE FROM cost_entries WHERE id=$1 AND source='manual' RETURNING amount_net", [id]);
  if (r.length) await audit({ userId: user.id, action: "cost.delete", entity: "cost_entry", entityId: id, details: r[0] });
  revalidatePath("/facturi", "layout");
}

/* ----------------------------- Setări ----------------------------- */

export async function saveSupplier(form: FormData) {
  const user = await requireUser("invoices");
  const id = Number(form.get("supplier_id"));
  await q("UPDATE suppliers SET default_category_id=$2, default_rule_id=$3, default_location_id=$4 WHERE id=$1",
    [id, idv(form.get("category_id")), idv(form.get("rule_id")), idv(form.get("rule_id")) ? null : idv(form.get("location_id"))]);
  await audit({ userId: user.id, action: "supplier.defaults", entity: "supplier", entityId: id });
  revalidatePath("/facturi", "layout");
}

export async function saveRule(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const name = String(form.get("name") ?? "").trim();
    const locs = form.getAll("location_id").map(Number);
    const pcts = form.getAll("pct").map(numv);
    const splits = locs.map((l, i) => ({ location_id: l, pct: pcts[i] ?? 0 })).filter((s) => s.pct > 0);
    if (!name) throw new Error("Dați un nume regulii (ex: „Jumătate Sibiu / BRUTĂRIE”).");
    const total = splits.reduce((s, x) => s + x.pct, 0);
    if (!splits.length || Math.abs(total - 100) > 0.001) throw new Error(`Procentele trebuie să însumeze 100% (acum ${total}%).`);
    await q("INSERT INTO allocation_rules (name, splits) VALUES ($1,$2::text::jsonb) ON CONFLICT (name) DO UPDATE SET splits=$2::text::jsonb", [name, JSON.stringify(splits)]);
    await audit({ userId: user.id, action: "allocation_rule.save", details: { name, splits } });
    return "Regula a fost salvată.";
  });
}

export async function saveFinanceSettings(form: FormData) {
  const user = await requireUser("invoices");
  const cif = String(form.get("company_cif") ?? "").trim().toUpperCase();
  const eur = numv(form.get("eur_rate"));
  if (cif) await q("INSERT INTO app_settings (key, value) VALUES ('company_cif', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value=$1::text::jsonb", [JSON.stringify(cif)]);
  if (eur && eur > 0) await q("INSERT INTO app_settings (key, value) VALUES ('eur_rate', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value=$1::text::jsonb", [JSON.stringify(eur)]);
  await audit({ userId: user.id, action: "settings.finance", details: { cif, eur } });
  revalidatePath("/facturi", "layout");
}
