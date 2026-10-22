import "server-only";
import { one, q } from "./db";
import type { SessionUser } from "./auth";

/** Cine poate deschide, închide sau anula un inventar. Personalul operațional doar numără. */
export const canManageInventory = (u: SessionUser) => ["admin", "location_manager", "production"].includes(u.role);
/** Personalul numără „orb”, fără să vadă stocul scriptic, ca să nu fie influențat. */
export const canSeeBook = (u: SessionUser) => u.role !== "staff";

export interface CountHeader {
  id: number;
  location_id: number;
  location: string;
  status: "open" | "closed" | "cancelled";
  as_of: string;
  started_at: string;
  closed_at: string | null;
  started_by: string;
  closed_by: string | null;
  note: string | null;
  posted_value: number | null;
  uncounted_as_zero: boolean | null;
  lines: number;
  counted: number;
}

export async function getCount(user: SessionUser, id: number) {
  const c = await one<CountHeader>(
    `SELECT c.id, c.location_id, l.name location, c.status, c.as_of, c.started_at, c.closed_at, su.name started_by, cu.name closed_by,
            c.note, c.posted_value::float8 posted_value, c.uncounted_as_zero,
            (SELECT count(*)::int FROM inventory_count_lines x WHERE x.count_id = c.id) lines,
            (SELECT count(*)::int FROM inventory_count_lines x WHERE x.count_id = c.id AND x.counted_qty IS NOT NULL) counted
       FROM inventory_counts c JOIN locations l ON l.id = c.location_id
       JOIN users su ON su.id = c.started_by LEFT JOIN users cu ON cu.id = c.closed_by
      WHERE c.id = $1`,
    [id],
  );
  if (!c || (user.locationIds !== null && !user.locationIds.includes(c.location_id))) return null;
  return c;
}

export interface CountLine {
  id: number;
  product_id: number;
  product: string;
  unit: string;
  category: string;
  book_qty: number;
  counted_qty: number | null;
  unit_value: number | null;
  counted_by: string | null;
  counted_at: string | null;
}

export async function getCountLines(countId: number) {
  return q<CountLine>(
    `SELECT l.id, p.id product_id, p.name product, p.unit, p.category, l.book_qty::float8 book_qty, l.counted_qty::float8 counted_qty,
            l.unit_value::float8 unit_value, u.name counted_by, l.counted_at
       FROM inventory_count_lines l JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.counted_by
      WHERE l.count_id = $1 ORDER BY p.name`,
    [countId],
  );
}

export async function listCounts(user: SessionUser) {
  const params: unknown[] = [];
  let where = "TRUE";
  if (user.locationIds !== null) { params.push(user.locationIds); where = "c.location_id = ANY($1::int[])"; }
  return q<{ id: number; location: string; status: string; as_of: string; closed_at: string | null; started_by: string; lines: number; counted: number; diff_lines: number; posted_value: number | null; minus_value: number | null }>(
    `SELECT c.id, l.name location, c.status, c.as_of, c.closed_at, u.name started_by, c.posted_value::float8 posted_value,
            count(x.id)::int lines, count(x.counted_qty)::int counted,
            count(*) FILTER (WHERE x.counted_qty IS NOT NULL AND x.counted_qty <> x.book_qty)::int diff_lines,
            sum(LEAST(x.counted_qty - x.book_qty, 0) * x.unit_value) FILTER (WHERE x.counted_qty IS NOT NULL)::float8 minus_value
       FROM inventory_counts c JOIN locations l ON l.id = c.location_id JOIN users u ON u.id = c.started_by
       LEFT JOIN inventory_count_lines x ON x.count_id = c.id
      WHERE ${where}
      GROUP BY c.id, l.name, u.name
      ORDER BY c.status = 'open' DESC, c.as_of DESC LIMIT 60`,
    params,
  );
}
