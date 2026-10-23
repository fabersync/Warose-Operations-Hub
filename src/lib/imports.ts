import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { one, q, tx, type Query } from "./db";
import { audit } from "./audit";
import { parsePublineSales, type PublineLine } from "./publine";
import { readFile, saveFile } from "./storage";

export interface ImportResult {
  batchId: number;
  status: "done" | "failed" | "duplicate";
  rowsTotal: number;
  rowsInserted: number;
  rowsDuplicate: number;
  rowsError: number;
  fileNet: number;
  dbNet: number;
  reconciled: boolean | null;
  warnings: string[];
  error?: string;
  duplicateOf?: number;
}

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const round2 = (n: number) => Math.round(n * 100) / 100;

const TYPE_TO_CATEGORY: Record<string, string> = {
  "MARFURI": "merchandise",
  "PRODUSE FINITE": "finished",
  "AMBALAJE SGR": "packaging",
  "SERVICII VANDUTE": "service",
};

/** Punctul unic de intrare pentru exporturile de vânzări Publine (agent, încărcare manuală, reluare). */
export async function ingestPublineSales(input: {
  buffer: Buffer;
  fileName: string;
  defaultLocationId: number | null;
  agentId?: number | null;
  userId?: number | null;
}): Promise<ImportResult> {
  const hash = sha256(input.buffer);
  const existing = await one<{ id: number }>(
    "SELECT id FROM import_batches WHERE source='publine' AND kind='sales_lines' AND file_sha256=$1 AND status IN ('done','processing')",
    [hash],
  );
  const ext = path.extname(input.fileName).toLowerCase() || ".bin";
  const storagePath = `publine/${hash.slice(0, 2)}/${hash}${ext}`;

  if (existing) {
    const b = await one<{ id: number }>(
      `INSERT INTO import_batches (source, kind, file_name, file_sha256, storage_path, status, default_location_id, agent_id, user_id, finished_at, error)
       VALUES ('publine','sales_lines',$1,$2,$3,'duplicate',$4,$5,$6,now(),$7) RETURNING id`,
      [input.fileName, hash, storagePath, input.defaultLocationId, input.agentId ?? null, input.userId ?? null,
       `Fișier identic deja importat (import #${existing.id}).`],
    );
    return {
      batchId: b!.id, status: "duplicate", rowsTotal: 0, rowsInserted: 0, rowsDuplicate: 0, rowsError: 0,
      fileNet: 0, dbNet: 0, reconciled: null, warnings: [], duplicateOf: existing.id,
    };
  }

  await saveFile(storagePath, input.buffer);
  const batch = await one<{ id: number }>(
    `INSERT INTO import_batches (source, kind, file_name, file_sha256, storage_path, status, default_location_id, agent_id, user_id)
     VALUES ('publine','sales_lines',$1,$2,$3,'processing',$4,$5,$6) RETURNING id`,
    [input.fileName, hash, storagePath, input.defaultLocationId, input.agentId ?? null, input.userId ?? null],
  );
  return processBatch(batch!.id, input.buffer, input.defaultLocationId, input.userId ?? null, input.agentId ?? null);
}

/** Reia procesarea unui import eșuat, din fișierul original păstrat. */
export async function retryBatch(batchId: number, userId: number): Promise<ImportResult> {
  const b = await one<{ storage_path: string; status: string; default_location_id: number | null; file_sha256: string }>(
    "SELECT storage_path, status, default_location_id, file_sha256 FROM import_batches WHERE id=$1",
    [batchId],
  );
  if (!b) throw new Error("Importul nu există.");
  if (b.status !== "failed") throw new Error("Doar importurile eșuate pot fi reluate.");
  const other = await one("SELECT id FROM import_batches WHERE file_sha256=$1 AND status IN ('done','processing') AND id<>$2", [b.file_sha256, batchId]);
  if (other) throw new Error(`Același fișier a fost deja importat cu succes (import #${other.id}).`);
  await q("UPDATE import_batches SET status='processing', error=NULL, finished_at=NULL WHERE id=$1", [batchId]);
  await q("DELETE FROM import_errors WHERE batch_id=$1", [batchId]);
  const buffer = await readFile(b.storage_path);
  await audit({ userId, action: "import.retry", entity: "import_batch", entityId: batchId });
  return processBatch(batchId, buffer, b.default_location_id, userId, null);
}

/**
 * Anulează un import de vânzări Publine: liniile lui dispar din vânzări și rapoarte, iar mișcările de stoc
 * pe care le-a generat sunt stornate (registrul de stoc nu se șterge). Fișierul original și istoricul rămân.
 * Liniile pe care un alt import le-a ignorat ca duplicat al acestuia nu revin singure: acel export se reimportă.
 */
export async function revertBatch(batchId: number, userId: number): Promise<{ lines: number; net: number }> {
  return tx(async (tq) => {
    const b = (await tq<{ status: string; kind: string; file_name: string }>(
      "SELECT status, kind, file_name FROM import_batches WHERE id=$1 FOR UPDATE", [batchId]))[0];
    if (!b) throw new Error("Importul nu există.");
    if (b.kind !== "sales_lines" || b.status !== "done") throw new Error("Doar importurile de vânzări finalizate pot fi anulate.");
    await tq(
      `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, reverses_id, note, created_by)
       SELECT m.location_id, m.product_id, -m.qty, 'reversal', m.occurred_at, m.id, 'Anulare import Publine #' || $1::int::text, $2
         FROM stock_movements m
        WHERE m.source_batch_id = $1::int AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)`,
      [batchId, userId],
    );
    const del = await tq<{ net: string }>("DELETE FROM sales_lines WHERE batch_id=$1 RETURNING net", [batchId]);
    const net = round2(del.reduce((s, r) => s + Number(r.net), 0));
    await tq(
      `UPDATE import_batches SET status='reverted', reverted_at=now(), reverted_by=$2,
              error='Anulat: ' || $3::text || ' linii scoase din vânzări (' || $4::text || ' lei fără TVA).'
        WHERE id=$1`,
      [batchId, userId, String(del.length), net.toFixed(2)],
    );
    await audit({ userId, action: "import.revert", entity: "import_batch", entityId: batchId, details: { file: b.file_name, lines: del.length, net } });
    return { lines: del.length, net };
  });
}

/**
 * Importurile rămase „în lucru” după o repornire a serverului devin eșuate, ca să nu blocheze fișierul:
 * altfel o retrimitere a aceluiași fișier ar fi considerată duplicat. Se reiau din pagina Importuri.
 */
export async function failInterruptedImports(): Promise<number> {
  const rows = await q(
    `UPDATE import_batches SET status='failed', finished_at=now(),
            error='Import întrerupt: serverul a repornit în timpul procesării. Apăsați „Reia”.'
      WHERE status='processing' RETURNING id`,
  );
  return rows.length;
}

// Un singur export procesat odată: două exporturi mari în paralel ar dubla memoria folosită.
let queue: Promise<unknown> = Promise.resolve();
function processBatch(...args: Parameters<typeof processBatchNow>): Promise<ImportResult> {
  const run = queue.then(() => processBatchNow(...args));
  queue = run.catch(() => undefined);
  return run;
}

async function processBatchNow(batchId: number, buffer: Buffer, defaultLocationId: number | null, userId: number | null, agentId: number | null): Promise<ImportResult> {
  try {
    const parsed = parsePublineSales(buffer);
    const result = await tx(async (tq) => {
      const warnings: string[] = [];
      const locByAlias = await resolveLocations(tq, parsed.lines, defaultLocationId, warnings);
      const productByCode = await resolveProducts(tq, parsed.lines);

      // Cheia liniei: aceeași vânzare exportată din nou (ex: export cumulativ lunar) produce aceeași cheie.
      // Liniile identice din același bon sunt diferențiate prin numărul de apariție.
      const occurrences = new Map<string, number>();
      const rows: unknown[][] = [];
      const rowErrors = [...parsed.errors];
      for (const l of parsed.lines) {
        const locationId = l.gestiune ? locByAlias.get(l.gestiune) ?? defaultLocationId : defaultLocationId;
        if (!locationId) {
          rowErrors.push({ rowNo: l.rowNo, message: `Locație necunoscută pentru gestiunea „${l.gestiune || "(goală)"}”.`, raw: l });
          continue;
        }
        const base = [locationId, l.soldAt, l.receiptNo, l.code, l.name, l.qty, l.net, l.gross].join("|");
        const occ = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, occ);
        rows.push([
          locationId, l.soldAt, l.soldAt.slice(0, 10), l.receiptNo, l.invoiceNo, l.tableName, l.code,
          l.code ? productByCode.get(l.code) ?? null : null, l.name, l.itemType, l.qty, l.unit, l.unitPrice,
          l.net, l.vat, l.gross, l.vatRate, l.paymentMethod, l.client, sha256(`publine|${base}|${occ}`), batchId,
        ]);
      }

      let inserted = 0;
      const CHUNK = 400;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const values = chunk.map((r) => {
          const ph = r.map((v) => { params.push(v); return `$${params.length}`; });
          return `(${ph.join(",")})`;
        });
        const res = await tq(
          `INSERT INTO sales_lines (location_id, sold_at, sold_date, receipt_no, invoice_no, table_name, source_code,
             product_id, product_name, item_type, qty, unit, unit_price, net, vat, gross, vat_rate, payment_method, client, line_key, batch_id)
           VALUES ${values.join(",")} ON CONFLICT (line_key) DO NOTHING RETURNING id`,
          params,
        );
        inserted += res.length;
      }

      // Vânzările noi ale produselor cu stoc gestionat scad din stocul locației: o mișcare pe produs și zi.
      // Doar liniile inserate de acest import au batch_id-ul lui, deci liniile duplicate nu se scad de două ori.
      const saleMoves = await tq(
        `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, source_batch_id, note)
         SELECT s.location_id, s.product_id, -sum(s.qty), 'sale', max(s.sold_at) AT TIME ZONE 'Europe/Bucharest', $1,
                'Vânzări Publine ' || to_char(s.sold_date, 'DD.MM.YYYY')
           FROM sales_lines s JOIN products p ON p.id = s.product_id AND p.track_stock
          WHERE s.batch_id = $1
          GROUP BY s.location_id, s.product_id, s.sold_date
         HAVING sum(s.qty) <> 0
         RETURNING id`,
        [batchId],
      );
      // Produsele preparate în magazin după rețetă (ex: cafea): se scad ingredientele cu stoc gestionat.
      await tq(
        `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, source_batch_id, note)
         SELECT s.location_id, i.ingredient_id, -round(sum(s.qty * i.qty / r.yield_qty), 3), 'sale', max(s.sold_at) AT TIME ZONE 'Europe/Bucharest', $1,
                'Rețete vânzări Publine ' || to_char(s.sold_date, 'DD.MM.YYYY')
           FROM sales_lines s
           JOIN products p ON p.id = s.product_id AND p.consume_recipe_on_sale AND NOT p.track_stock
           JOIN recipes r ON r.product_id = p.id AND r.active
           JOIN recipe_items i ON i.recipe_id = r.id
           JOIN products ip ON ip.id = i.ingredient_id AND ip.track_stock
          WHERE s.batch_id = $1
          GROUP BY s.location_id, i.ingredient_id, s.sold_date
         HAVING round(sum(s.qty * i.qty / r.yield_qty), 3) <> 0`,
        [batchId],
      );

      for (const e of rowErrors) {
        await tq("INSERT INTO import_errors (batch_id, row_no, message, raw) VALUES ($1,$2,$3,$4::text::jsonb)", [batchId, e.rowNo, e.message, JSON.stringify(e.raw)]);
      }

      // Reconciliere: totalul din fișier trebuie să fie egal cu totalul liniilor din baza de date pentru cheile fișierului.
      const fileNet = round2(parsed.lines.reduce((s, l) => s + l.net, 0));
      const fileGross = round2(parsed.lines.reduce((s, l) => s + l.gross, 0));
      const keys = rows.map((r) => r[19] as string);
      const sums = await tq<{ net: number; gross: number }>(
        "SELECT coalesce(sum(net),0)::float8 AS net, coalesce(sum(gross),0)::float8 AS gross FROM sales_lines WHERE line_key = ANY($1::text[])",
        [keys],
      );
      const dbNet = round2(sums[0].net);
      const dbGross = round2(sums[0].gross);
      const reconciled = rowErrors.length === 0 && Math.abs(dbNet - fileNet) < 0.01 && Math.abs(dbGross - fileGross) < 0.01;
      const dates = parsed.lines.map((l) => l.soldAt).sort();

      await tq(
        `UPDATE import_batches SET status='done', rows_total=$2, rows_inserted=$3, rows_duplicate=$4, rows_error=$5,
           file_net_total=$6, file_gross_total=$7, db_net_total=$8, db_gross_total=$9, reconciled=$10,
           period_from=$11, period_to=$12, warnings=$13::text::jsonb, finished_at=now() WHERE id=$1`,
        [batchId, parsed.lines.length + parsed.errors.length, inserted, rows.length - inserted, rowErrors.length,
         fileNet, fileGross, dbNet, dbGross, reconciled, dates[0] ?? null, dates[dates.length - 1] ?? null, JSON.stringify(warnings)],
      );
      await audit({ userId, agentId, action: "import.publine_sales", entity: "import_batch", entityId: batchId,
        details: { inserted, duplicate: rows.length - inserted, errors: rowErrors.length, fileNet, dbNet, reconciled, stockMovements: saleMoves.length } }, tq);

      return {
        batchId, status: "done" as const, rowsTotal: parsed.lines.length + parsed.errors.length, rowsInserted: inserted,
        rowsDuplicate: rows.length - inserted, rowsError: rowErrors.length, fileNet, dbNet, reconciled, warnings,
      };
    });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await q("UPDATE import_batches SET status='failed', error=$2, finished_at=now() WHERE id=$1", [batchId, message]);
    await audit({ userId, agentId, action: "import.failed", entity: "import_batch", entityId: batchId, details: { error: message } });
    return {
      batchId, status: "failed", rowsTotal: 0, rowsInserted: 0, rowsDuplicate: 0, rowsError: 0,
      fileNet: 0, dbNet: 0, reconciled: null, warnings: [], error: message,
    };
  }
}

async function resolveLocations(tq: Query, lines: PublineLine[], defaultLocationId: number | null, warnings: string[]) {
  const aliases = [...new Set(lines.map((l) => l.gestiune).filter(Boolean))];
  const map = new Map<string, number>();
  if (!aliases.length) return map;
  const known = await tq<{ alias: string; location_id: number | null }>(
    "SELECT alias, location_id FROM location_aliases WHERE source='publine' AND alias = ANY($1::text[])",
    [aliases],
  );
  for (const k of known) if (k.location_id) map.set(k.alias, k.location_id);
  for (const a of aliases) {
    if (map.has(a)) continue;
    if (!known.some((k) => k.alias === a)) {
      await tq("INSERT INTO location_aliases (source, alias) VALUES ('publine',$1) ON CONFLICT DO NOTHING", [a]);
    }
    const n = lines.filter((l) => l.gestiune === a).length;
    warnings.push(`Gestiunea Publine „${a}” (${n} linii) nu este asociată cu o locație; liniile au fost atribuite locației implicite a importului. Asociați-o în Setări → Locații.`);
  }
  return map;
}

async function resolveProducts(tq: Query, lines: PublineLine[]) {
  const byCode = new Map<string, PublineLine>();
  for (const l of lines) if (l.code && !byCode.has(l.code)) byCode.set(l.code, l);
  const map = new Map<string, number>();
  if (!byCode.size) return map;
  const known = await tq<{ code: string; product_id: number | null }>(
    "SELECT code, product_id FROM product_codes WHERE source='publine' AND code = ANY($1::text[])",
    [[...byCode.keys()]],
  );
  for (const k of known) if (k.product_id) map.set(k.code, k.product_id);
  for (const [code, l] of byCode) {
    if (known.some((k) => k.code === code)) continue;
    // Cod Publine nou: se creează automat produsul în catalog, pentru a nu bloca importul.
    // Administratorul îl poate ulterior asocia cu alt produs (ex: echivalentul din SAGA).
    const p = (await tq<{ id: number }>(
      "INSERT INTO products (name, unit, category, sale_price, vat_rate) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [l.name, (l.unit ?? "buc").toLowerCase(), TYPE_TO_CATEGORY[(l.itemType ?? "").toUpperCase()] ?? "other", l.priceWithVat, l.vatRate],
    ))[0];
    await tq("INSERT INTO product_codes (source, code, name_in_source, product_id) VALUES ('publine',$1,$2,$3)", [code, l.name, p.id]);
    map.set(code, p.id);
  }
  return map;
}
