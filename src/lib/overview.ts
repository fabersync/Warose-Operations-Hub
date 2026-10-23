import "server-only";
import { q } from "./db";
import type { SessionUser } from "./auth";
import { salesWhere, type SalesFilter } from "./queries";

/** Date suplimentare pentru dashboard și exportul complet, pe perioadă și locație. */

export async function salesByHour(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return q<{ hour: number; net: number; receipts: number }>(
    `SELECT h AS hour, coalesce(x.net, 0)::float8 net, coalesce(x.receipts, 0)::int receipts
       FROM generate_series(6, 22) h
       LEFT JOIN (SELECT extract(hour FROM sold_at)::int hr, sum(net) net, count(DISTINCT (location_id, sold_date, receipt_no)) receipts
                    FROM sales_lines s WHERE ${where} GROUP BY 1) x ON x.hr = h
      ORDER BY 1`,
    params,
  );
}

export async function salesByWeekday(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return q<{ dow: number; net: number; days: number }>(
    `SELECT extract(isodow FROM sold_date)::int dow, sum(net)::float8 net, count(DISTINCT sold_date)::int days
       FROM sales_lines s WHERE ${where} GROUP BY 1 ORDER BY 1`,
    params,
  );
}

export async function salesByCategory(user: SessionUser, f: SalesFilter) {
  const { where, params } = salesWhere(user, f);
  return q<{ category: string; net: number; qty: number }>(
    `SELECT coalesce(nullif(initcap(item_type), ''), 'Nedefinit') category, sum(net)::float8 net, sum(qty)::float8 qty
       FROM sales_lines s WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
    params,
  );
}

/** Costurile din facturi (alocate pe locații) pe categorii, în perioadă. */
export async function costsByCategory(f: { from: string; to: string; locationIds: number[] | null }) {
  const params: unknown[] = [f.from, f.to];
  let where = "e.entry_date BETWEEN $1::date AND $2::date";
  if (f.locationIds) { params.push(f.locationIds); where += ` AND e.location_id = ANY($3::int[])`; }
  return q<{ category: string; amount: number }>(
    `SELECT c.name category, sum(e.amount_net)::float8 amount FROM cost_entries e JOIN expense_categories c ON c.id = e.category_id
      WHERE ${where} GROUP BY c.name, c.sort ORDER BY c.sort, c.name`,
    params,
  );
}

export async function topSuppliers(f: { from: string; to: string; locationIds: number[] | null }) {
  const params: unknown[] = [f.from, f.to];
  let where = "e.entry_date BETWEEN $1::date AND $2::date AND e.source = 'invoice'";
  if (f.locationIds) { params.push(f.locationIds); where += ` AND e.location_id = ANY($3::int[])`; }
  return q<{ supplier: string; amount: number; invoices: number }>(
    `SELECT coalesce(s.name, e.supplier, '—') supplier, sum(e.amount_net)::float8 amount, count(DISTINCT e.invoice_id)::int invoices
       FROM cost_entries e LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    params,
  );
}

/** Pierderi, consum personal și protocol: valoarea la cost în perioadă. */
export async function internalTotals(f: { from: string; to: string; locationIds: number[] | null }) {
  const params: unknown[] = [f.from, f.to];
  let where = "u.use_date BETWEEN $1::date AND $2::date AND u.cancelled_at IS NULL";
  if (f.locationIds) { params.push(f.locationIds); where += ` AND u.location_id = ANY($3::int[])`; }
  const rows = await q<{ kind: string; cost: number; sale: number; n: number }>(
    `SELECT kind, coalesce(sum(qty * unit_cost), 0)::float8 cost, coalesce(sum(qty * unit_price), 0)::float8 sale, count(*)::int n
       FROM internal_uses u WHERE ${where} GROUP BY kind`,
    params,
  );
  const get = (k: string) => rows.find((r) => r.kind === k) ?? { cost: 0, sale: 0, n: 0 };
  return { loss: get("loss"), staff: get("staff"), protocol: get("protocol") };
}

/** Locațiile vizibile pentru filtru: toate locațiile permise sau doar cea aleasă. */
export function scopeIds(user: SessionUser, locationId: number | null): number[] | null {
  if (locationId) return [locationId];
  return user.locationIds;
}
