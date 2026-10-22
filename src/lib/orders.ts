import "server-only";
import { one, q } from "./db";
import type { SessionUser } from "./auth";

export type OrderStatus = "draft" | "submitted" | "confirmed" | "preparing" | "shipped" | "received" | "cancelled";

export const STATUS: Record<OrderStatus, { label: string; tone: "neutral" | "info" | "warn" | "good" | "bad" | "accent" }> = {
  draft: { label: "Ciornă", tone: "neutral" },
  submitted: { label: "Trimisă", tone: "info" },
  confirmed: { label: "Confirmată", tone: "accent" },
  preparing: { label: "În pregătire", tone: "warn" },
  shipped: { label: "Expediată", tone: "info" },
  received: { label: "Recepționată", tone: "good" },
  cancelled: { label: "Anulată", tone: "neutral" },
};
export const FLOW: OrderStatus[] = ["draft", "submitted", "confirmed", "preparing", "shipped", "received"];
/** Stări în care cantitatea este „rezervată” din stocul furnizorului. */
export const OPEN: OrderStatus[] = ["submitted", "confirmed", "preparing"];

const sees = (u: SessionUser, locationId: number) => u.locationIds === null || u.locationIds.includes(locationId);
/** Locația care comandă: managerul creează și trimite; managerul sau personalul recepționează. */
export const canOrder = (u: SessionUser, fromId: number) => ["admin", "location_manager"].includes(u.role) && sees(u, fromId);
export const canReceive = (u: SessionUser, fromId: number) => ["admin", "location_manager", "staff"].includes(u.role) && sees(u, fromId);
/** Furnizorul (BRUTĂRIE / congelator): confirmă, pregătește, expediază. */
export const canFulfil = (u: SessionUser, toId: number) => ["admin", "production"].includes(u.role) && sees(u, toId);

export async function listOrders(user: SessionUser, status?: string) {
  const params: unknown[] = [];
  const where = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`(o.from_location_id = ANY($1::int[]) OR o.to_location_id = ANY($1::int[]))`); }
  if (status === "open") where.push(`o.status IN ('submitted','confirmed','preparing','shipped')`);
  else if (status && status !== "all") { params.push(status); where.push(`o.status = $${params.length}`); }
  return q<{ id: number; from_name: string; to_name: string; needed_for: string; status: OrderStatus; lines: number; ordered: number; shipped: number | null; received: number | null; author: string; created_at: string }>(
    `SELECT o.id, f.name from_name, t.name to_name, o.needed_for::text needed_for, o.status, count(l.id)::int lines,
            coalesce(sum(l.ordered_qty),0)::float8 ordered, sum(l.shipped_qty)::float8 shipped, sum(l.received_qty)::float8 received,
            u.name author, o.created_at
       FROM location_orders o JOIN locations f ON f.id = o.from_location_id JOIN locations t ON t.id = o.to_location_id
       JOIN users u ON u.id = o.created_by LEFT JOIN location_order_lines l ON l.order_id = o.id
      WHERE ${where.join(" AND ")}
      GROUP BY o.id, f.name, t.name, u.name
      ORDER BY CASE o.status WHEN 'submitted' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'preparing' THEN 2 WHEN 'shipped' THEN 3 WHEN 'draft' THEN 4 ELSE 5 END,
               o.needed_for, o.id DESC
      LIMIT 200`,
    params,
  );
}

export async function getOrder(user: SessionUser, id: number) {
  const o = await one<{ id: number; from_location_id: number; to_location_id: number; from_name: string; to_name: string; to_kind: string; needed_for: string; status: OrderStatus; note: string | null;
    author: string; created_at: string; submitted_at: string | null; confirmed_at: string | null; shipped_at: string | null; received_at: string | null; cancelled_at: string | null; cancel_reason: string | null }>(
    `SELECT o.id, o.from_location_id, o.to_location_id, f.name from_name, t.name to_name, t.kind to_kind, o.needed_for::text needed_for, o.status, o.note,
            u.name author, o.created_at, o.submitted_at, o.confirmed_at, o.shipped_at, o.received_at, o.cancelled_at, o.cancel_reason
       FROM location_orders o JOIN locations f ON f.id = o.from_location_id JOIN locations t ON t.id = o.to_location_id JOIN users u ON u.id = o.created_by
      WHERE o.id = $1`,
    [id],
  );
  if (!o || !(sees(user, o.from_location_id) || sees(user, o.to_location_id))) return null;
  const lines = await q<{ id: number; product_id: number; product: string; unit: string; ordered_qty: number; confirmed_qty: number | null; shipped_qty: number | null; received_qty: number | null; note: string | null;
    source_stock: number; reserved_other: number; saga_code: string | null }>(
    `SELECT l.id, p.id product_id, p.name product, p.unit, l.ordered_qty::float8 ordered_qty, l.confirmed_qty::float8 confirmed_qty,
            l.shipped_qty::float8 shipped_qty, l.received_qty::float8 received_qty, l.note,
            coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id = $2 AND m.product_id = p.id), 0)::float8 source_stock,
            coalesce((SELECT sum(coalesce(ol.confirmed_qty, ol.ordered_qty)) FROM location_order_lines ol JOIN location_orders oo ON oo.id = ol.order_id
                       WHERE oo.to_location_id = $2 AND oo.status IN ('submitted','confirmed','preparing') AND oo.id <> $1 AND ol.product_id = p.id), 0)::float8 reserved_other,
            (SELECT c.code FROM product_codes c WHERE c.product_id = p.id AND c.source = 'saga' ORDER BY c.id LIMIT 1) saga_code
       FROM location_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY p.name`,
    [id, o.to_location_id],
  );
  const events = await q<{ id: number; at: string; user_name: string | null; kind: string; status: string | null; message: string | null }>(
    `SELECT e.id, e.at, u.name user_name, e.kind, e.status, e.message FROM location_order_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.order_id = $1 ORDER BY e.at, e.id`,
    [id],
  );
  const shipments = await q<{ product: string; lot: string | null; qty: number; produced_on: string | null; expires_on: string | null }>(
    `SELECT p.name product, m.lot, -m.qty::float8 qty, m.produced_on::text produced_on, m.expires_on::text expires_on
       FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.location_order_id = $1 AND m.kind = 'transfer_out' ORDER BY p.name, m.produced_on NULLS LAST`,
    [id],
  );
  return { ...o, lines, events, shipments };
}

/** Produsele care pot fi comandate: congelate sau produse finite. */
export async function orderableProducts() {
  return q<{ id: number; name: string; unit: string }>(
    "SELECT id, name, unit FROM products WHERE active AND (is_frozen OR category = 'finished') ORDER BY name",
  );
}

/**
 * Necesarul total pentru comenzile deschise (trimise / confirmate / în pregătire), pe furnizor și produs,
 * comparat cu stocul furnizorului.
 */
export async function openDemand(user: SessionUser, from: string, to: string) {
  const params: unknown[] = [from, to];
  let scope = "TRUE";
  if (user.locationIds !== null) { params.push(user.locationIds); scope = "o.to_location_id = ANY($3::int[])"; }
  return q<{ to_location_id: number; to_name: string; to_kind: string; product_id: number; product: string; unit: string; demand: number; orders: number; stock: number; has_recipe: boolean }>(
    `SELECT o.to_location_id, t.name to_name, t.kind to_kind, p.id product_id, p.name product, p.unit,
            sum(coalesce(l.confirmed_qty, l.ordered_qty))::float8 demand, count(DISTINCT o.id)::int orders,
            coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id = o.to_location_id AND m.product_id = p.id), 0)::float8 stock,
            EXISTS (SELECT 1 FROM recipes r WHERE r.product_id = p.id AND r.active) has_recipe
       FROM location_orders o JOIN location_order_lines l ON l.order_id = o.id JOIN products p ON p.id = l.product_id
       JOIN locations t ON t.id = o.to_location_id
      WHERE o.status IN ('submitted','confirmed','preparing') AND o.needed_for BETWEEN $1::date AND $2::date AND ${scope}
      GROUP BY o.to_location_id, t.name, t.kind, p.id
      ORDER BY t.name, p.name`,
    params,
  );
}
