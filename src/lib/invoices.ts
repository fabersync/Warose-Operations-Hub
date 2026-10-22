import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { one, q, tx, type Query } from "./db";
import { audit } from "./audit";
import { extractXml, normCif, parseEInvoice } from "./efactura";
import { saveFile } from "./storage";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await one<{ value: T }>("SELECT value FROM app_settings WHERE key=$1", [key]);
  return r ? r.value : fallback;
}

export const itemKey = (code: string | null, description: string) =>
  code ? `code:${code.trim().toUpperCase()}` : `desc:${description.toUpperCase().replace(/\s+/g, " ").trim()}`;

/** Furnizorul după CIF (sau după nume, dacă nu are CIF); se creează automat la primul document. */
export async function findOrCreateSupplier(tq: Query, name: string, cif: string | null) {
  const c = normCif(cif);
  const existing = c
    ? (await tq<{ id: number }>("SELECT id FROM suppliers WHERE cif=$1", [c]))[0]
    : (await tq<{ id: number }>("SELECT id FROM suppliers WHERE cif IS NULL AND upper(name)=upper($1)", [name.trim()]))[0];
  if (existing) return existing.id;
  return (await tq<{ id: number }>("INSERT INTO suppliers (name, cif) VALUES ($1,$2) RETURNING id", [name.trim(), c]))[0].id;
}

/** Aplică memoria de asocieri a furnizorului pe liniile încă neasociate ale unei facturi. */
export async function applyItemMap(tq: Query, invoiceId: number, supplierId: number) {
  await tq(
    `UPDATE invoice_lines l SET product_id = m.product_id, factor = m.factor, category_id = m.category_id,
            to_stock = coalesce((SELECT p.track_stock FROM products p WHERE p.id = m.product_id), false)
       FROM supplier_item_map m
      WHERE l.invoice_id = $1 AND m.supplier_id = $2 AND l.product_id IS NULL AND l.category_id IS NULL
        AND m.item_key = CASE WHEN l.supplier_code IS NOT NULL THEN 'code:' || upper(trim(l.supplier_code))
                              ELSE 'desc:' || upper(regexp_replace(trim(l.description), '\\s+', ' ', 'g')) END`,
    [invoiceId, supplierId],
  );
}

export type ImportOutcome = { fileName: string; status: "imported" | "duplicate" | "error"; message: string; invoiceId?: number };

/** Importă o factură e-Factura (XML sau ZIP din SPV). Dublurile sunt blocate după fișier și după furnizor + număr + dată. */
/** Indexul de descărcare SPV din numele fișierelor SAGA: F_<index>_<nr>_<data>.xml — identificator stabil al facturii în SPV. */
export function spvIndexFromName(fileName: string): string | null {
  const m = path.basename(fileName).match(/^F_(\d{6,})_/i);
  return m ? m[1] : null;
}

export async function importEInvoice(
  buffer: Buffer, fileName: string, userId: number | null,
  opts: { agentId?: number | null; locationId?: number | null; spvIndex?: string | null } = {},
): Promise<ImportOutcome> {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const sameFile = await one<{ id: number }>("SELECT id FROM invoices WHERE file_sha256=$1 AND status <> 'cancelled'", [hash]);
  if (sameFile) return { fileName, status: "duplicate", message: `Fișier deja importat (factura #${sameFile.id}).`, invoiceId: sameFile.id };
  const spvIndex = opts.spvIndex ?? spvIndexFromName(fileName);
  if (spvIndex) {
    const sameSpv = await one<{ id: number }>("SELECT id FROM invoices WHERE spv_index=$1 AND status <> 'cancelled'", [spvIndex]);
    if (sameSpv) return { fileName, status: "duplicate", message: `Factura SPV ${spvIndex} este deja importată (#${sameSpv.id}).`, invoiceId: sameSpv.id };
  }
  let inv;
  try {
    inv = parseEInvoice(extractXml(buffer, fileName));
  } catch (e) {
    return { fileName, status: "error", message: (e as Error).message };
  }
  const companyCif = normCif(await getSetting<string>("company_cif", ""));
  if (companyCif && inv.customerCif && inv.customerCif !== companyCif) {
    return { fileName, status: "error", message: `Factura este emisă către CIF ${inv.customerCif}, nu către firmă (${companyCif}).` };
  }
  const sign = inv.isCreditNote ? -1 : 1;
  const storagePath = await saveFile(`facturi/${hash.slice(0, 2)}/${hash}${path.extname(fileName).toLowerCase() || ".xml"}`, buffer);
  return tx(async (tq) => {
    const supplierId = await findOrCreateSupplier(tq, inv.supplier.name, inv.supplier.cif);
    const dup = (await tq<{ id: number }>(
      "SELECT id FROM invoices WHERE supplier_id=$1 AND upper(number)=upper($2) AND issue_date=$3 AND status <> 'cancelled'",
      [supplierId, inv.number, inv.issueDate]))[0];
    if (dup) return { fileName, status: "duplicate" as const, message: `Factura ${inv.number} din ${inv.issueDate} de la ${inv.supplier.name} există deja (#${dup.id}).`, invoiceId: dup.id };
    const s = (await tq<{ default_category_id: number | null; default_rule_id: number | null; default_location_id: number | null }>(
      "SELECT default_category_id, default_rule_id, default_location_id FROM suppliers WHERE id=$1", [supplierId]))[0];
    // Locația vine din configurația explicită a agentului (înregistrat pe o locație), nu din numele furnizorului.
    // Alocarea implicită a furnizorului (setată de utilizator) are prioritate; altfel, locația agentului.
    const allocLocation = s.default_rule_id ? null : s.default_location_id ?? opts.locationId ?? null;
    const id = (await tq<{ id: number }>(
      `INSERT INTO invoices (supplier_id, number, issue_date, due_date, currency, total_net, total_vat, total_gross, is_credit_note, source,
                             file_path, file_name, file_sha256, category_id, rule_id, allocation_location_id, receipt_location_id, created_by,
                             spv_index, agent_id, prepaid, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'efactura',$10,$11,$12,$13,$14,$15,
               coalesce($17, (SELECT id FROM locations WHERE kind='production' AND active ORDER BY id LIMIT 1)),$16,$18,$19,$20,$21) RETURNING id`,
      [supplierId, inv.number, inv.issueDate, inv.dueDate, inv.currency, sign * inv.totalNet, sign * inv.totalVat, sign * inv.totalGross, inv.isCreditNote,
       storagePath, fileName, hash, s.default_category_id, s.default_rule_id, allocLocation, userId, opts.locationId ?? null,
       spvIndex, opts.agentId ?? null, inv.prepaid, inv.warnings.length ? `Verificări XML: ${inv.warnings.join(" ")}` : null]))[0].id;
    for (const l of inv.lines) {
      await tq(
        `INSERT INTO invoice_lines (invoice_id, line_no, description, supplier_code, qty, unit, unit_price, net, vat_rate, vat, gross_unit_price, discount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, l.lineNo, l.description, l.supplierCode, sign * l.qty, l.unit, l.unitPrice, sign * l.net, l.vatRate,
         Math.round(sign * l.net * (l.vatRate ?? 0)) / 100, l.grossUnitPrice, l.discount == null ? null : sign * l.discount],
      );
    }
    await applyItemMap(tq, id, supplierId);
    await audit({ userId, agentId: opts.agentId ?? null, action: "invoice.import_efactura", entity: "invoice", entityId: id, details: { number: inv.number, supplier: inv.supplier.name, total: inv.totalGross } }, tq);
    return { fileName, status: "imported" as const, message: `${inv.supplier.name} · nr. ${inv.number} · ${inv.lines.length} linii · ${inv.totalGross.toFixed(2)} ${inv.currency}`, invoiceId: id };
  });
}

export async function listInvoices(status: string) {
  const where = status === "all" ? "TRUE" : status === "saga" ? "i.status = 'verified' AND i.saga_registered_at IS NULL" : "i.status = $1";
  return q<{ id: number; supplier: string; cif: string | null; number: string; issue_date: string; total_net: number; total_gross: number; status: string; source: string; is_credit_note: boolean; saga: boolean; lines: number; mapped: number }>(
    `SELECT i.id, s.name supplier, s.cif, i.number, i.issue_date::text issue_date, i.total_net::float8 total_net, i.total_gross::float8 total_gross,
            i.status, i.source, i.is_credit_note, i.saga_registered_at IS NOT NULL saga,
            (SELECT count(*)::int FROM invoice_lines l WHERE l.invoice_id = i.id) lines,
            (SELECT count(*)::int FROM invoice_lines l WHERE l.invoice_id = i.id AND (l.product_id IS NOT NULL OR l.category_id IS NOT NULL)) mapped
       FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE ${where} ORDER BY i.status = 'draft' DESC, i.issue_date DESC, i.id DESC LIMIT 200`,
    status === "all" || status === "saga" ? [] : [status],
  );
}

export async function getInvoice(id: number) {
  const inv = await one<{ id: number; supplier_id: number; supplier: string; cif: string | null; number: string; issue_date: string; due_date: string | null; currency: string;
    total_net: number; total_vat: number; total_gross: number; is_credit_note: boolean; status: string; source: string; file_name: string | null; pdf_path: string | null; file_path: string | null;
    category_id: number | null; rule_id: number | null; allocation_location_id: number | null; receipt_location_id: number | null; note: string | null;
    author: string | null; created_at: string; verified_by: string | null; verified_at: string | null; saga_registered_at: string | null; saga_note: string | null }>(
    `SELECT i.id, i.supplier_id, s.name supplier, s.cif, i.number, i.issue_date::text issue_date, i.due_date::text due_date, i.currency,
            i.total_net::float8 total_net, i.total_vat::float8 total_vat, i.total_gross::float8 total_gross, i.is_credit_note, i.status, i.source,
            i.file_name, i.pdf_path, i.file_path, i.category_id, i.rule_id, i.allocation_location_id, i.receipt_location_id, i.note,
            u.name author, i.created_at, vu.name verified_by, i.verified_at, i.saga_registered_at, i.saga_note
       FROM invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users vu ON vu.id = i.verified_by
      WHERE i.id = $1`,
    [id],
  );
  if (!inv) return null;
  const lines = await q<{ id: number; line_no: number; description: string; supplier_code: string | null; qty: number; unit: string | null; unit_price: number | null; net: number; vat_rate: number | null; vat: number; gross_unit_price: number | null; discount: number | null;
    product_id: number | null; product_unit: string | null; factor: number; category_id: number | null; to_stock: boolean; prev_cost: number | null }>(
    `SELECT l.id, l.line_no, l.description, l.supplier_code, l.qty::float8 qty, l.unit, l.unit_price::float8 unit_price, l.net::float8 net,
            l.vat_rate::float8 vat_rate, l.vat::float8 vat, l.gross_unit_price::float8 gross_unit_price, l.discount::float8 discount, l.product_id, p.unit product_unit, l.factor::float8 factor, l.category_id, l.to_stock,
            (SELECT h.unit_cost::float8 FROM price_history h WHERE h.product_id = l.product_id AND (h.invoice_id IS DISTINCT FROM l.invoice_id)
               AND h.price_date <= $2::date ORDER BY h.price_date DESC, h.id DESC LIMIT 1) prev_cost
       FROM invoice_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.invoice_id = $1 ORDER BY l.line_no`,
    [id, inv.issue_date],
  );
  return { ...inv, lines };
}

/** Împarte o sumă după procente, cu ajustarea rotunjirii pe ultima locație (suma rămâne exactă). */
export function splitAmount(amount: number, splits: { location_id: number; pct: number }[]) {
  const parts = splits.map((s) => ({ location_id: s.location_id, amount: Math.round(amount * s.pct) / 100 }));
  const diff = Math.round((amount - parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
  if (parts.length) parts[parts.length - 1].amount = Math.round((parts[parts.length - 1].amount + diff) * 100) / 100;
  return parts;
}

/** Costurile unei luni: matrice locație × categorie + venituri din vânzările Publine (fără TVA). */
export async function costMonth(month: string) {
  const from = `${month}-01`;
  const [cells, revenue, entries] = await Promise.all([
    q<{ location_id: number; category_id: number; amount: number }>(
      `SELECT location_id, category_id, sum(amount_net)::float8 amount FROM cost_entries
        WHERE entry_date >= $1::date AND entry_date < $1::date + interval '1 month' GROUP BY 1, 2`, [from]),
    q<{ location_id: number; amount: number }>(
      `SELECT location_id, sum(net)::float8 amount FROM sales_lines
        WHERE sold_date >= $1::date AND sold_date < $1::date + interval '1 month' GROUP BY 1`, [from]),
    q<{ id: number; entry_date: string; location: string; location_id: number; category: string; amount_net: number; supplier: string | null; description: string | null; source: string; invoice_id: number | null }>(
      `SELECT e.id, e.entry_date::text entry_date, l.name location, e.location_id, c.name category, e.amount_net::float8 amount_net, e.supplier, e.description, e.source, e.invoice_id
         FROM cost_entries e JOIN locations l ON l.id = e.location_id JOIN expense_categories c ON c.id = e.category_id
        WHERE e.entry_date >= $1::date AND e.entry_date < $1::date + interval '1 month'
        ORDER BY l.name, e.entry_date, e.id`, [from]),
  ]);
  return { cells, revenue, entries };
}
