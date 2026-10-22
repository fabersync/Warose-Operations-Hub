import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import * as XLSX from "xlsx";
import { one, q, tx } from "./db";
import { audit } from "./audit";
import { toLocalDateTime } from "./publine";
import { saveFile } from "./storage";

/**
 * Raportul SAGA C „Situația producției” (Excel). Structura verificată pe decembrie 2025:
 * antet „Data | Nr. doc. | Denumire | Cod | UM | Cantitate | Pret | Valoare”, cu rânduri „Gestiune: X” între grupuri.
 * Importul NU modifică SAGA; servește la asocierea codurilor și la compararea cu producția din aplicație.
 */
interface SagaLine { rowNo: number; gestiune: string | null; date: string; docNo: string | null; code: string; name: string; unit: string | null; qty: number; price: number | null; value: number | null }

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const numv = (v: unknown) => (v === null || v === "" || v === undefined ? null : typeof v === "number" ? v : Number(String(v).replace(",", ".")));

export function parseSagaProduction(buffer: Buffer): { lines: SagaLine[]; errors: { rowNo: number; message: string }[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const h = rows.findIndex((r) => { const c = (r ?? []).map(norm); return c.includes("nr. doc.") && c.includes("cod") && c.includes("cantitate"); });
  if (h === -1) throw new Error("Fișierul nu pare a fi raportul SAGA „Situația producției” (lipsește antetul Data / Nr. doc. / Cod / Cantitate).");
  const head = rows[h].map(norm);
  const col = (name: string) => head.indexOf(name);
  const c = { date: col("data"), doc: col("nr. doc."), name: col("denumire"), code: col("cod"), unit: col("um"), qty: col("cantitate"), price: col("pret"), value: col("valoare") };
  const lines: SagaLine[] = [];
  const errors: { rowNo: number; message: string }[] = [];
  let gestiune: string | null = null;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = norm(r[0]);
    if (first.startsWith("gestiune")) { gestiune = String(r.slice(1).find((x) => x != null && String(x).trim()) ?? "").trim().toUpperCase() || null; continue; }
    const code = r[c.code] == null ? "" : String(r[c.code]).trim();
    const qty = numv(r[c.qty]);
    if (!code && qty == null) continue; // rânduri goale / totaluri
    const date = toLocalDateTime(r[c.date])?.slice(0, 10);
    if (!date || !code || qty == null || !Number.isFinite(qty)) { errors.push({ rowNo: i + 1, message: "Rând incomplet (dată, cod sau cantitate)." }); continue; }
    // În exportul SAGA antetul „Pret / Valoare” este decalat față de date (celulă îmbinată), așa că
    // prețul și valoarea sunt primele două valori numerice de după cantitate, verificate prin cantitate × preț.
    const after = r.slice(c.qty + 1).map(numv).filter((v): v is number => v != null && Number.isFinite(v));
    const [price, value] = after.length >= 2 ? after : [numv(r[c.price]), numv(r[c.value])];
    if (price != null && value != null && Math.abs(price * qty - value) > Math.max(0.05, Math.abs(value) * 0.01)) {
      errors.push({ rowNo: i + 1, message: `Valoarea ${value} nu corespunde cantitate × preț (${qty} × ${price}).` });
      continue;
    }
    lines.push({
      rowNo: i + 1, gestiune, date, docNo: r[c.doc] == null ? null : String(r[c.doc]).replace(/\.0$/, ""),
      code: /^\d+$/.test(code) ? code.padStart(8, "0") : code, name: String(r[c.name] ?? "").trim().replace(/\s+/g, " "),
      unit: r[c.unit] == null ? null : String(r[c.unit]).trim().toLowerCase() || null, qty, price, value,
    });
  }
  return { lines, errors };
}

export async function ingestSagaProduction(buffer: Buffer, fileName: string, userId: number) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const dup = await one<{ id: number }>("SELECT id FROM import_batches WHERE source='saga' AND kind='production' AND file_sha256=$1 AND status='done'", [hash]);
  if (dup) return { status: "duplicate" as const, message: `Fișierul a fost deja importat (import #${dup.id}).` };
  const parsed = parseSagaProduction(buffer);
  const storagePath = await saveFile(`saga/${hash.slice(0, 2)}/${hash}${path.extname(fileName).toLowerCase() || ".xlsx"}`, buffer);
  return tx(async (tq) => {
    const b = (await tq<{ id: number }>(
      `INSERT INTO import_batches (source, kind, file_name, file_sha256, storage_path, status, user_id)
       VALUES ('saga','production',$1,$2,$3,'processing',$4) RETURNING id`, [fileName, hash, storagePath, userId]))[0];
    const occ = new Map<string, number>();
    let inserted = 0;
    for (const l of parsed.lines) {
      // Cheia nu depinde de preț/valoare (calculate de SAGA), ci doar de document, cod și cantitate.
      const base = [l.gestiune, l.date, l.docNo, l.code, l.qty].join("|");
      const n = (occ.get(base) ?? 0) + 1; occ.set(base, n);
      const key = crypto.createHash("sha256").update(`saga|${base}|${n}`).digest("hex");
      const res = await tq(
        `INSERT INTO saga_production_lines (batch_id, gestiune, doc_date, doc_no, code, name, unit, qty, unit_price, value, line_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (line_key) DO NOTHING RETURNING id`,
        [b.id, l.gestiune, l.date, l.docNo, l.code, l.name, l.unit, l.qty, l.price, l.value, key]);
      inserted += res.length;
      await tq("INSERT INTO product_codes (source, code, name_in_source) VALUES ('saga',$1,$2) ON CONFLICT (source, code) DO NOTHING", [l.code, l.name]);
    }
    for (const e of parsed.errors) await tq("INSERT INTO import_errors (batch_id, row_no, message) VALUES ($1,$2,$3)", [b.id, e.rowNo, e.message]);
    const fileValue = Math.round(parsed.lines.reduce((s, l) => s + (l.value ?? 0), 0) * 100) / 100;
    const dates = parsed.lines.map((l) => l.date).sort();
    await tq(
      `UPDATE import_batches SET status='done', rows_total=$2, rows_inserted=$3, rows_duplicate=$4, rows_error=$5, file_net_total=$6,
              db_net_total=$6, reconciled=$7, period_from=$8, period_to=$9, finished_at=now() WHERE id=$1`,
      [b.id, parsed.lines.length + parsed.errors.length, inserted, parsed.lines.length - inserted, parsed.errors.length, fileValue,
       parsed.errors.length === 0, dates[0] ?? null, dates[dates.length - 1] ?? null]);
    await audit({ userId, action: "import.saga_production", entity: "import_batch", entityId: b.id, details: { inserted, errors: parsed.errors.length, fileValue } }, tq);
    return { status: "done" as const, message: `${inserted} linii noi, ${parsed.lines.length - inserted} existente, ${parsed.errors.length} erori. Valoare totală ${fileValue.toLocaleString("ro-RO")} lei.` };
  });
}

/** Comparația lunară: cantitățile din SAGA vs. documentele aprobate în aplicație, pe produs. */
export async function sagaComparison(month: string) {
  const from = `${month}-01`;
  return q<{ product_id: number | null; product: string; codes: string; saga_qty: number; hub_qty: number }>(
    `WITH s AS (
        SELECT c.product_id, CASE WHEN c.product_id IS NULL THEN 'saga:' || s.code ELSE c.product_id::text END k,
               max(s.name) saga_name, string_agg(DISTINCT s.code, ', ') codes, sum(s.qty) qty
          FROM saga_production_lines s LEFT JOIN product_codes c ON c.source = 'saga' AND c.code = s.code
         WHERE s.doc_date >= $1::date AND s.doc_date < ($1::date + interval '1 month')
         GROUP BY 1, 2),
      h AS (
        SELECT pl.product_id, pl.product_id::text k, sum(pl.produced_qty) qty
          FROM production_orders o JOIN production_lines pl ON pl.order_id = o.id
         WHERE o.status = 'approved' AND o.planned_for >= $1::date AND o.planned_for < ($1::date + interval '1 month')
         GROUP BY pl.product_id)
     SELECT coalesce(s.product_id, h.product_id) product_id,
            coalesce(p.name, s.saga_name) product, coalesce(s.codes, '') codes,
            coalesce(s.qty, 0)::float8 saga_qty, coalesce(h.qty, 0)::float8 hub_qty
       FROM s FULL JOIN h ON h.k = s.k
       LEFT JOIN products p ON p.id = coalesce(s.product_id, h.product_id)
      ORDER BY abs(coalesce(s.qty,0) - coalesce(h.qty,0)) DESC, 2`,
    [from],
  );
}
