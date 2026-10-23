import "server-only";
import { q, one } from "./db";
import type { SessionUser } from "./auth";

export interface SalesFilter {
  from: string; // YYYY-MM-DD inclusiv
  to: string;   // YYYY-MM-DD inclusiv
  locationId?: number | null;
  search?: string | null;
}

/** Construiește WHERE-ul comun pentru vânzări, cu restricția de locație a utilizatorului. */
export function salesWhere(user: SessionUser, f: SalesFilter, alias = "s") {
  const params: unknown[] = [f.from, f.to];
  const parts = [`${alias}.sold_date BETWEEN $1::date AND $2::date`];
  if (user.locationIds !== null) {
    params.push(user.locationIds);
    parts.push(`${alias}.location_id = ANY($${params.length}::int[])`);
  }
  if (f.locationId) {
    params.push(f.locationId);
    parts.push(`${alias}.location_id = $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    parts.push(`${alias}.product_name ILIKE $${params.length}`);
  }
  return { where: parts.join(" AND "), params };
}

export async function locationsFor(user: SessionUser, kinds?: string[]) {
  const rows = await q<{ id: number; code: string; name: string; kind: string }>(
    "SELECT id, code, name, kind FROM locations WHERE active ORDER BY id",
  );
  return rows.filter((l) => (user.locationIds === null || user.locationIds.includes(l.id)) && (!kinds || kinds.includes(l.kind)));
}

export async function salesTotals(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return (await one<{ net: number; gross: number; qty: number; receipts: number; lines: number }>(
    `SELECT coalesce(sum(net),0)::float8 net, coalesce(sum(gross),0)::float8 gross,
            coalesce(sum(qty),0)::float8 qty, count(*)::int lines,
            count(DISTINCT (location_id, sold_date, receipt_no))::int receipts
       FROM sales_lines s WHERE ${where}`,
    params,
  ))!;
}

export async function salesByDay(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return q<{ day: string; net: number; gross: number }>(
    `SELECT d::date::text AS day, coalesce(x.net,0)::float8 net, coalesce(x.gross,0)::float8 gross
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN (SELECT sold_date, sum(net) net, sum(gross) gross FROM sales_lines s WHERE ${where} GROUP BY sold_date) x
         ON x.sold_date = d::date
      ORDER BY 1`,
    params,
  );
}

export async function salesByLocation(user: SessionUser, f: SalesFilter, prev: SalesFilter) {
  const cur = salesWhere(user, f);
  const rows = await q<{ id: number; name: string; net: number; receipts: number }>(
    `SELECT l.id, l.name, coalesce(sum(s.net),0)::float8 net, count(DISTINCT (s.sold_date, s.receipt_no))::int receipts
       FROM sales_lines s JOIN locations l ON l.id = s.location_id
      WHERE ${cur.where} GROUP BY l.id, l.name ORDER BY net DESC`,
    cur.params,
  );
  const p = salesWhere(user, prev);
  const prevRows = await q<{ id: number; net: number }>(
    `SELECT location_id id, sum(net)::float8 net FROM sales_lines s WHERE ${p.where} GROUP BY location_id`,
    p.params,
  );
  return rows.map((r) => ({ ...r, prevNet: prevRows.find((x) => x.id === r.id)?.net ?? 0 }));
}

export interface ProductPerf {
  product_id: number | null;
  name: string;
  qty: number;
  net: number;
  prev_qty: number;
  prev_net: number;
}

/** Performanța pe produs în perioada curentă vs. perioada precedentă de aceeași lungime. */
export async function productPerformance(user: SessionUser, f: SalesFilter, prev: SalesFilter): Promise<ProductPerf[]> {
  const cur = salesWhere(user, f);
  const p = salesWhere(user, prev, "s");
  const shift = cur.params.length;
  const prevWhere = p.where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + shift}`);
  return q<ProductPerf>(
    `WITH cur AS (
        SELECT coalesce(product_id::text, product_name) k, max(product_id) product_id, max(product_name) name,
               sum(qty)::float8 qty, sum(net)::float8 net
          FROM sales_lines s WHERE ${cur.where} AND coalesce(item_type,'') NOT IN ('Ambalaje SGR')
         GROUP BY 1),
      prv AS (
        SELECT coalesce(product_id::text, product_name) k, max(product_id) product_id, max(product_name) name,
               sum(qty)::float8 qty, sum(net)::float8 net
          FROM sales_lines s WHERE ${prevWhere} AND coalesce(item_type,'') NOT IN ('Ambalaje SGR')
         GROUP BY 1)
     SELECT coalesce(cur.product_id, prv.product_id) product_id, coalesce(cur.name, prv.name) name,
            coalesce(cur.qty,0) qty, coalesce(cur.net,0) net, coalesce(prv.qty,0) prev_qty, coalesce(prv.net,0) prev_net
       FROM cur FULL JOIN prv ON prv.k = cur.k`,
    [...cur.params, ...p.params],
  );
}

export async function paymentMix(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return q<{ method: string; gross: number }>(
    `SELECT coalesce(payment_method,'NESPECIFICAT') method, sum(gross)::float8 gross
       FROM sales_lines s WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
    params,
  );
}

export async function lastSaleTimestamp(user: SessionUser) {
  const params: unknown[] = [];
  let where = "TRUE";
  if (user.locationIds !== null) { params.push(user.locationIds); where = "location_id = ANY($1::int[])"; }
  return (await one<{ ts: string | null; d: string | null }>(
    `SELECT to_char(max(sold_at),'YYYY-MM-DD HH24:MI:SS') ts, max(sold_date)::text d FROM sales_lines WHERE ${where}`,
    params,
  ))!;
}

export interface AgentStatus {
  version?: string; host?: string; at?: string; online?: boolean; queued?: number; rejected?: number; lastError?: string | null;
  sources?: { type: string; folder: string; ok: boolean; message?: string; files?: number; new?: number; ignored?: number; waiting?: number }[];
}

export async function syncStatus() {
  const agents = await q<{ id: number; name: string; location: string; last_seen_at: string | null; last_upload_at: string | null; last_status: string | null; active: boolean; agent_status: AgentStatus | null }>(
    `SELECT a.id, a.name, l.name location, a.last_seen_at, a.last_upload_at, a.last_status, a.active, a.status agent_status
       FROM sync_agents a JOIN locations l ON l.id = a.location_id ORDER BY a.id`,
  );
  const lastImport = await one<{ id: number; status: string; file_name: string; created_at: string; reconciled: boolean | null }>(
    "SELECT id, status, file_name, created_at, reconciled FROM import_batches ORDER BY id DESC LIMIT 1",
  );
  const failed = (await one<{ n: number }>("SELECT count(*)::int n FROM import_batches WHERE status='failed'"))!.n;
  const unmappedAliases = (await one<{ n: number }>("SELECT count(*)::int n FROM location_aliases WHERE location_id IS NULL"))!.n;
  return { agents, lastImport, failed, unmappedAliases };
}

/** Stocul operațional = suma mișcărilor confirmate. */
export async function stockLevels(user: SessionUser, opts: { locationId?: number | null; frozenOnly?: boolean } = {}) {
  const params: unknown[] = [];
  const parts = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); parts.push(`m.location_id = ANY($${params.length}::int[])`); }
  if (opts.locationId) { params.push(opts.locationId); parts.push(`m.location_id = $${params.length}`); }
  if (opts.frozenOnly) parts.push("(p.is_frozen OR l.kind = 'freezer')");
  return q<{ location_id: number; location: string; product_id: number; product: string; unit: string; qty: number; last_move: string; oldest_lot_date: string | null; nearest_expiry: string | null }>(
    `SELECT m.location_id, l.name location, p.id product_id, p.name product, p.unit,
            sum(m.qty)::float8 qty, max(m.occurred_at) last_move,
            min(m.produced_on) FILTER (WHERE m.qty > 0)::text oldest_lot_date,
            min(m.expires_on) FILTER (WHERE m.qty > 0)::text nearest_expiry
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
      WHERE ${parts.join(" AND ")}
      GROUP BY m.location_id, l.name, p.id, p.name, p.unit
     HAVING sum(m.qty) <> 0
      ORDER BY l.name, p.name`,
    params,
  );
}

/** Loturi încă disponibile într-o locație (FIFO pe data producției), calculat din mișcări. */
export async function lotBalances(user: SessionUser, locationId: number) {
  if (user.locationIds !== null && !user.locationIds.includes(locationId)) return [];
  return q<{ product_id: number; product: string; unit: string; lot: string | null; produced_on: string | null; expires_on: string | null; qty: number }>(
    // Lotul este identificat doar prin cod; datele de producție/expirare vin din intrări,
    // pentru ca ieșirile (care nu repetă datele) să scadă din același lot.
    `SELECT p.id product_id, p.name product, p.unit, m.lot,
            min(m.produced_on) FILTER (WHERE m.qty > 0)::text produced_on,
            min(m.expires_on) FILTER (WHERE m.qty > 0)::text expires_on,
            sum(m.qty)::float8 qty
       FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.location_id = $1
      GROUP BY p.id, p.name, p.unit, m.lot
     HAVING sum(m.qty) > 0
      ORDER BY p.name, 5 NULLS LAST`,
    [locationId],
  );
}

export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Recepție",
  production: "Producție",
  consumption: "Consum",
  transfer_out: "Transfer ieșire",
  transfer_in: "Transfer intrare",
  loss: "Pierdere / rebut",
  adjustment: "Ajustare",
  inventory: "Diferență inventar",
  sale: "Vânzare",
  reversal: "Stornare",
};

export async function recentMovements(user: SessionUser, opts: { locationId?: number | null; limit?: number; frozenOnly?: boolean } = {}) {
  const params: unknown[] = [];
  const parts = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); parts.push(`m.location_id = ANY($${params.length}::int[])`); }
  if (opts.locationId) { params.push(opts.locationId); parts.push(`m.location_id = $${params.length}`); }
  if (opts.frozenOnly) parts.push("(p.is_frozen OR l.kind = 'freezer')");
  params.push(opts.limit ?? 50);
  return q<{ id: number; occurred_at: string; location: string; product: string; unit: string; qty: number; kind: string; lot: string | null; counterpart: string | null; document_ref: string | null; note: string | null; user_name: string; reverses_id: number | null; reversed: boolean }>(
    `SELECT m.id, m.occurred_at, l.name location, p.name product, p.unit, m.qty::float8 qty, m.kind, m.lot,
            cl.name counterpart, m.document_ref, m.note, coalesce(u.name, 'Import Publine #' || m.source_batch_id) user_name, m.reverses_id,
            EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id) reversed
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       JOIN locations l ON l.id = m.location_id
       LEFT JOIN locations cl ON cl.id = m.counterpart_location_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE ${parts.join(" AND ")}
      ORDER BY m.occurred_at DESC, m.id DESC LIMIT $${params.length}`,
    params,
  );
}
