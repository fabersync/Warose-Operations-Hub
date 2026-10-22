import "server-only";
import { one, q, type Query } from "./db";
import type { SessionUser } from "./auth";

export const canEditProduction = (u: SessionUser) => u.role === "admin" || u.role === "production";

export const ORDER_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "good" | "bad" }> = {
  planned: { label: "Planificat", tone: "info" },
  recorded: { label: "De aprobat", tone: "warn" },
  approved: { label: "Aprobat", tone: "good" },
  cancelled: { label: "Anulat", tone: "neutral" },
};

export interface RecipeRow {
  product_id: number;
  product: string;
  unit: string;
  recipe_id: number | null;
  version: number | null;
  yield_qty: number | null;
  items: number;
  missing_prices: number;
  batch_cost: number | null;
  sale_price: number | null;
  vat_rate: number | null;
}

/** Lista produselor finite cu rețeta activă și costul teoretic pe unitate. */
export async function recipeList(): Promise<RecipeRow[]> {
  return q<RecipeRow>(
    `SELECT p.id product_id, p.name product, p.unit, r.id recipe_id, r.version, r.yield_qty::float8 yield_qty,
            count(i.id)::int items,
            count(i.id) FILTER (WHERE ip.cost_price IS NULL)::int missing_prices,
            sum(i.qty * ip.cost_price)::float8 batch_cost,
            p.sale_price::float8 sale_price, p.vat_rate::float8 vat_rate
       FROM products p
       LEFT JOIN recipes r ON r.product_id = p.id AND r.active
       LEFT JOIN recipe_items i ON i.recipe_id = r.id
       LEFT JOIN products ip ON ip.id = i.ingredient_id
      WHERE p.active AND (p.category = 'finished' OR r.id IS NOT NULL)
      GROUP BY p.id, r.id
      ORDER BY (r.id IS NULL), p.name`,
  );
}

export async function activeRecipe(productId: number) {
  const r = await one<{ id: number; version: number; yield_qty: number; note: string | null; created_at: string; author: string }>(
    `SELECT r.id, r.version, r.yield_qty::float8 yield_qty, r.note, r.created_at, u.name author
       FROM recipes r JOIN users u ON u.id = r.created_by WHERE r.product_id = $1 AND r.active`,
    [productId],
  );
  if (!r) return null;
  const items = await q<{ ingredient_id: number; name: string; unit: string; qty: number; cost_price: number | null; cost_updated_at: string | null }>(
    `SELECT i.ingredient_id, p.name, p.unit, i.qty::float8 qty, p.cost_price::float8 cost_price, p.cost_updated_at
       FROM recipe_items i JOIN products p ON p.id = i.ingredient_id WHERE i.recipe_id = $1 ORDER BY p.name`,
    [r.id],
  );
  return { ...r, items };
}

export async function recipeHistory(productId: number) {
  return q<{ id: number; version: number; yield_qty: number; active: boolean; created_at: string; author: string; items: number }>(
    `SELECT r.id, r.version, r.yield_qty::float8 yield_qty, r.active, r.created_at, u.name author,
            (SELECT count(*)::int FROM recipe_items i WHERE i.recipe_id = r.id) items
       FROM recipes r JOIN users u ON u.id = r.created_by WHERE r.product_id = $1 ORDER BY r.version DESC`,
    [productId],
  );
}

export interface Requirement {
  ingredient_id: number;
  name: string;
  unit: string;
  track_stock: boolean;
  needed: number;
  available: number;
  cost_price: number | null;
}

/**
 * Necesarul de materii prime pentru liniile de producție date (produs, cantitate), din rețetele active,
 * comparat cu stocul operațional al locației de producție.
 */
export async function requirementsFor(lines: { product_id: number; qty: number }[], locationId: number, query: Query = q): Promise<Requirement[]> {
  if (!lines.length) return [];
  return query<Requirement>(
    `WITH l AS (SELECT * FROM unnest($1::int[], $2::numeric[]) AS t(product_id, qty)),
          need AS (
            SELECT i.ingredient_id, sum(i.qty * l.qty / r.yield_qty) needed
              FROM l JOIN recipes r ON r.product_id = l.product_id AND r.active
              JOIN recipe_items i ON i.recipe_id = r.id
             GROUP BY i.ingredient_id)
     SELECT p.id ingredient_id, p.name, p.unit, p.track_stock, need.needed::float8 needed,
            coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id = $3 AND m.product_id = p.id), 0)::float8 available,
            p.cost_price::float8 cost_price
       FROM need JOIN products p ON p.id = need.ingredient_id
      ORDER BY p.name`,
    [lines.map((x) => x.product_id), lines.map((x) => x.qty), locationId],
  );
}

export async function listOrders(user: SessionUser, status?: string) {
  const params: unknown[] = [];
  const where = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`o.location_id = ANY($${params.length}::int[])`); }
  if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
  return q<{ id: number; planned_for: string; status: string; location: string; lines: number; planned: number; produced: number | null; author: string; saga_doc_no: string | null; note: string | null }>(
    `SELECT o.id, o.planned_for::text planned_for, o.status, l.name location, count(pl.id)::int lines,
            sum(pl.planned_qty)::float8 planned, sum(pl.produced_qty)::float8 produced, u.name author, o.saga_doc_no, o.note
       FROM production_orders o JOIN locations l ON l.id = o.location_id JOIN users u ON u.id = o.created_by
       LEFT JOIN production_lines pl ON pl.order_id = o.id
      WHERE ${where.join(" AND ")}
      GROUP BY o.id, l.name, u.name
      ORDER BY CASE o.status WHEN 'recorded' THEN 0 WHEN 'planned' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, o.planned_for DESC, o.id DESC
      LIMIT 100`,
    params,
  );
}

export async function getOrder(user: SessionUser, id: number) {
  const o = await one<{ id: number; location_id: number; location: string; freezer_location_id: number | null; freezer: string | null; planned_for: string; status: string; note: string | null;
    author: string; created_at: string; recorded_by: string | null; recorded_at: string | null; approved_by: string | null; approved_at: string | null;
    saga_doc_no: string | null; saga_registered_at: string | null }>(
    `SELECT o.id, o.location_id, l.name location, o.freezer_location_id, f.name freezer, o.planned_for::text planned_for, o.status, o.note,
            u.name author, o.created_at, ru.name recorded_by, o.recorded_at, au.name approved_by, o.approved_at, o.saga_doc_no, o.saga_registered_at
       FROM production_orders o JOIN locations l ON l.id = o.location_id LEFT JOIN locations f ON f.id = o.freezer_location_id
       JOIN users u ON u.id = o.created_by LEFT JOIN users ru ON ru.id = o.recorded_by LEFT JOIN users au ON au.id = o.approved_by
      WHERE o.id = $1`,
    [id],
  );
  if (!o || (user.locationIds !== null && !user.locationIds.includes(o.location_id))) return null;
  const lines = await q<{ id: number; product_id: number; product: string; unit: string; planned_qty: number; produced_qty: number | null; to_freezer_qty: number | null; scrap_qty: number | null; expires_on: string | null; recipe_id: number | null; recipe_version: number | null; has_active_recipe: boolean; saga_code: string | null }>(
    `SELECT pl.id, p.id product_id, p.name product, p.unit, pl.planned_qty::float8 planned_qty, pl.produced_qty::float8 produced_qty,
            pl.to_freezer_qty::float8 to_freezer_qty, pl.scrap_qty::float8 scrap_qty, pl.expires_on::text expires_on,
            pl.recipe_id, r.version recipe_version,
            EXISTS (SELECT 1 FROM recipes ar WHERE ar.product_id = p.id AND ar.active) has_active_recipe,
            (SELECT c.code FROM product_codes c WHERE c.product_id = p.id AND c.source = 'saga' ORDER BY c.id LIMIT 1) saga_code
       FROM production_lines pl JOIN products p ON p.id = pl.product_id LEFT JOIN recipes r ON r.id = pl.recipe_id
      WHERE pl.order_id = $1 ORDER BY p.name`,
    [id],
  );
  const consumption = await q<{ ingredient_id: number; name: string; unit: string; theoretical_qty: number; actual_qty: number | null; unit_cost: number | null; track_stock: boolean; saga_code: string | null }>(
    `SELECT c.ingredient_id, p.name, p.unit, c.theoretical_qty::float8 theoretical_qty, c.actual_qty::float8 actual_qty,
            c.unit_cost::float8 unit_cost, p.track_stock,
            (SELECT pc.code FROM product_codes pc WHERE pc.product_id = p.id AND pc.source = 'saga' ORDER BY pc.id LIMIT 1) saga_code
       FROM production_consumption c JOIN products p ON p.id = c.ingredient_id WHERE c.order_id = $1 ORDER BY p.name`,
    [id],
  );
  return { ...o, lines, consumption };
}
