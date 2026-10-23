"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, canSeeLocation, type SessionUser } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canPurchase, getPurchaseOrder } from "@/lib/purchasing";
import { emailLayout, esc, sendEmail } from "@/lib/notify";

export type FormState = { error?: string; ok?: string };
const numv = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };

async function run(fn: (u: SessionUser) => Promise<string | void>): Promise<FormState> {
  try {
    const user = await requireUser("purchasing");
    const ok = await fn(user);
    revalidatePath("/aprovizionare", "layout");
    return { ok: ok || undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function editable(user: SessionUser, id: number, statuses: string[]) {
  const o = await one<{ location_id: number; status: string }>("SELECT location_id, status FROM purchase_orders WHERE id=$1", [id]);
  if (!o) throw new Error("Comanda nu există.");
  if (!canPurchase(user, o.location_id)) throw new Error("Nu aveți dreptul să modificați comenzile acestei locații.");
  if (!statuses.includes(o.status)) throw new Error("Comanda nu mai poate fi modificată în starea actuală.");
  return o;
}

/** Creează sau actualizează o ciornă de comandă către furnizor. */
export async function savePurchaseOrder(_: FormState, form: FormData): Promise<FormState> {
  let id = Number(form.get("order_id")) || 0;
  const res = await run(async (user) => {
    const locationId = Number(form.get("location_id"));
    const supplierId = Number(form.get("supplier_id"));
    const neededFor = String(form.get("needed_for") ?? "") || null;
    const note = String(form.get("note") ?? "").trim() || null;
    const ids = form.getAll("product_id").map(Number);
    const qtys = form.getAll("qty").map(numv);
    const lines = ids.map((p, i) => ({ p, qty: qtys[i] })).filter((l) => l.p && l.qty);
    if (!canPurchase(user, locationId)) throw new Error("Alegeți o locație pentru care puteți comanda.");
    if (!supplierId) throw new Error("Alegeți furnizorul.");
    if (neededFor && !/^\d{4}-\d{2}-\d{2}$/.test(neededFor)) throw new Error("Data livrării nu este validă.");
    if (!lines.length) throw new Error("Adăugați cel puțin un produs cu cantitate.");
    if (lines.some((l) => !Number.isFinite(l.qty!) || l.qty! <= 0)) throw new Error("Cantitățile trebuie să fie pozitive.");
    if (new Set(lines.map((l) => l.p)).size !== lines.length) throw new Error("Un produs apare de două ori.");
    id = await tx(async (tq) => {
      let oid = id;
      if (oid) {
        await editable(user, oid, ["draft"]);
        await tq("UPDATE purchase_orders SET location_id=$2, supplier_id=$3, needed_for=$4, note=$5 WHERE id=$1", [oid, locationId, supplierId, neededFor, note]);
        await tq("DELETE FROM purchase_order_lines WHERE order_id=$1", [oid]);
      } else {
        oid = (await tq<{ id: number }>(
          "INSERT INTO purchase_orders (supplier_id, location_id, needed_for, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [supplierId, locationId, neededFor, note, user.id]))[0].id;
      }
      for (const l of lines) {
        // Prețul estimat = ultimul preț de achiziție cunoscut (din facturi), în unitatea produsului.
        await tq(`INSERT INTO purchase_order_lines (order_id, product_id, qty, unit, est_price)
                  SELECT $1, p.id, $3, p.unit, p.cost_price FROM products p WHERE p.id = $2`, [oid, l.p, l.qty]);
      }
      await audit({ userId: user.id, action: "purchase_order.save", entity: "purchase_order", entityId: oid, details: { supplierId, locationId, lines } }, tq);
      return oid;
    });
  });
  if (res.error) return res;
  redirect(`/aprovizionare/${id}`);
}

/**
 * Marchează comanda ca trimisă. Cu „email”, o trimite furnizorului pe adresa din fișa lui (doar la cererea utilizatorului).
 * Pentru Metro / cash & carry se folosește de obicei lista tipărită sau Excelul.
 */
export async function sendPurchaseOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const via = String(form.get("via") ?? "manual");
    await editable(user, id, ["draft"]);
    let note = "Marcată ca trimisă (telefon / listă tipărită / la magazin).";
    if (via === "email") {
      const o = (await getPurchaseOrder(user, id))!;
      if (!o.supplier_email) throw new Error("Furnizorul nu are adresă de email. Completați-o în fișa furnizorului de pe această pagină.");
      const rows = o.lines.map((l) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(l.product)}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${l.qty} ${esc(l.unit)}</td></tr>`).join("");
      const html = emailLayout(`Comandă Warose Bakery nr. ${o.id}`, `Livrare la: ${o.location}${o.needed_for ? ` · data dorită: ${o.needed_for}` : ""}`,
        `<table style="width:100%;border-collapse:collapse">${rows}</table>${o.note ? `<p style="margin-top:12px;font-size:14px">${esc(o.note)}</p>` : ""}`);
      const status = await sendEmail(o.supplier_email, `Comandă Warose Bakery nr. ${o.id} — ${o.location}`, html,
        o.lines.map((l) => `${l.product}: ${l.qty} ${l.unit}`).join("\n"));
      if (status.startsWith("error")) throw new Error(`Emailul nu a putut fi trimis: ${status}`);
      note = status === "sent" ? `Trimisă pe email la ${o.supplier_email}.` : "SMTP neconfigurat: emailul a fost doar salvat local (.data/outbox), NU a ajuns la furnizor.";
    }
    await q("UPDATE purchase_orders SET status='sent', sent_at=now(), sent_by=$2, sent_via=$3 WHERE id=$1", [id, user.id, via]);
    await audit({ userId: user.id, action: "purchase_order.send", entity: "purchase_order", entityId: id, details: { via } });
    return note;
  });
}

/** Livrarea: cantitățile primite și, opțional, factura furnizorului. Stocul intră prin verificarea facturii (o singură sursă). */
export async function deliverPurchaseOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const invoiceId = Number(form.get("invoice_id")) || null;
    const lineIds = form.getAll("line_id").map(Number);
    const qtys = form.getAll("received_qty").map(numv);
    if (qtys.some((v) => v == null || !Number.isFinite(v) || v < 0)) throw new Error("Completați cantitatea primită pentru fiecare produs (0 dacă lipsește).");
    await editable(user, id, ["sent", "draft"]);
    await tx(async (tq) => {
      for (const [i, lid] of lineIds.entries()) await tq("UPDATE purchase_order_lines SET received_qty=$3 WHERE id=$1 AND order_id=$2", [lid, id, qtys[i]]);
      await tq("UPDATE purchase_orders SET status='delivered', delivered_at=now(), delivered_by=$2, invoice_id=$3 WHERE id=$1", [id, user.id, invoiceId]);
      await audit({ userId: user.id, action: "purchase_order.delivered", entity: "purchase_order", entityId: id, details: { invoiceId } }, tq);
    });
    return invoiceId ? "Livrare înregistrată și legată de factură." : "Livrare înregistrată. Stocul se actualizează la verificarea facturii.";
  });
}

export async function cancelPurchaseOrder(form: FormData) {
  const user = await requireUser("purchasing");
  const id = Number(form.get("order_id"));
  await editable(user, id, ["draft", "sent"]);
  await q("UPDATE purchase_orders SET status='cancelled', cancelled_at=now() WHERE id=$1", [id]);
  await audit({ userId: user.id, action: "purchase_order.cancel", entity: "purchase_order", entityId: id });
  revalidatePath("/aprovizionare", "layout");
  redirect("/aprovizionare");
}

export async function saveSupplierContact(form: FormData) {
  const user = await requireUser("purchasing");
  const id = Number(form.get("supplier_id"));
  const email = String(form.get("email") ?? "").trim() || null;
  const phone = String(form.get("phone") ?? "").trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  await q("UPDATE suppliers SET email=$2, phone=$3 WHERE id=$1", [id, email, phone]);
  await audit({ userId: user.id, action: "supplier.contact", entity: "supplier", entityId: id, details: { email, phone } });
  revalidatePath("/aprovizionare", "layout");
}

export async function createSupplier(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const name = String(form.get("name") ?? "").trim();
    const cif = String(form.get("cif") ?? "").trim().toUpperCase().replace(/^RO/, "") || null;
    if (!name) throw new Error("Completați numele furnizorului.");
    const r = await one<{ id: number }>("INSERT INTO suppliers (name, cif) VALUES ($1,$2) ON CONFLICT (cif) DO NOTHING RETURNING id", [name, cif]);
    if (!r) throw new Error("Există deja un furnizor cu acest CIF.");
    await audit({ userId: user.id, action: "supplier.create", entity: "supplier", entityId: r.id, details: { name, cif } });
    return "Furnizorul a fost adăugat.";
  });
}

/** Furnizorii obișnuiți ai unei locații (apar primii la comenzi și în necesar). */
export async function setLocationSupplier(form: FormData) {
  const user = await requireUser("purchasing");
  const locationId = Number(form.get("location_id"));
  const supplierId = Number(form.get("supplier_id"));
  if (!supplierId || !canPurchase(user, locationId)) return;
  if (form.get("op") === "remove") await q("DELETE FROM location_suppliers WHERE location_id=$1 AND supplier_id=$2", [locationId, supplierId]);
  else await q("INSERT INTO location_suppliers (location_id, supplier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [locationId, supplierId]);
  await audit({ userId: user.id, action: `location_supplier.${form.get("op") === "remove" ? "remove" : "add"}`, entity: "location", entityId: locationId, details: { supplierId } });
  revalidatePath("/aprovizionare", "layout");
}

/** Stocurile minime și țintă ale unei locații: sub minim, produsul apare în propunerile de comandă. */
export async function saveTargets(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const locationId = Number(form.get("location_id"));
    if (!canSeeLocation(user, locationId) || !canPurchase(user, locationId)) throw new Error("Nu aveți acces la această locație.");
    const ids = form.getAll("product_id").map(Number);
    const mins = form.getAll("min_qty").map(numv);
    const targets = form.getAll("target_qty").map(numv);
    const sups = form.getAll("supplier_id").map((v) => Number(v) || null);
    let saved = 0;
    await tx(async (tq) => {
      for (const [i, pid] of ids.entries()) {
        const min = mins[i], target = targets[i], sup = sups[i] ?? null;
        if (min == null && target == null && !sup) { await tq("DELETE FROM stock_targets WHERE location_id=$1 AND product_id=$2", [locationId, pid]); continue; }
        if ([min, target].some((v) => v != null && (!Number.isFinite(v) || v < 0))) throw new Error("Valorile trebuie să fie pozitive.");
        const t = target ?? min ?? 0; const m = min ?? 0;
        if (t < m) throw new Error("Stocul țintă trebuie să fie cel puțin cât minimul.");
        await tq(`INSERT INTO stock_targets (location_id, product_id, min_qty, target_qty, supplier_id) VALUES ($1,$2,$3,$4,$5)
                  ON CONFLICT (location_id, product_id) DO UPDATE SET min_qty=$3, target_qty=$4, supplier_id=$5`, [locationId, pid, m, t, sup]);
        saved++;
      }
      await audit({ userId: user.id, action: "stock_targets.save", entity: "location", entityId: locationId, details: { saved } }, tq);
    });
    return `${saved} produse cu stoc minim salvate.`;
  });
}
