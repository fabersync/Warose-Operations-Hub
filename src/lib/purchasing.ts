import "server-only";
import { one, q } from "./db";
import type { SessionUser } from "./auth";

/** Cine creează și trimite comenzi către furnizori: administrator, BRUTĂRIE și managerii, pentru locațiile lor. */
export const canPurchase = (u: SessionUser, locationId: number) =>
  ["admin", "production", "location_manager"].includes(u.role) && (u.locationIds === null || u.locationIds.includes(locationId));

export const PO_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "good" | "warn" }> = {
  draft: { label: "Ciornă", tone: "neutral" },
  sent: { label: "Trimisă", tone: "info" },
  delivered: { label: "Livrată", tone: "good" },
  cancelled: { label: "Anulată", tone: "neutral" },
};

/** Locațiile care pot comanda: magazinele și BRUTĂRIE (congelatorul primește marfă doar prin transferuri). */
export async function purchasingLocations(user: SessionUser) {
  const rows = await q<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM locations WHERE active AND kind IN ('store','production') ORDER BY id");
  return rows.filter((l) => user.locationIds === null || user.locationIds.includes(l.id));
}

export interface NeedRow {
  location_id: number; location: string; product_id: number; product: string; unit: string;
  stock: number; min_qty: number | null; target_qty: number | null; production_need: number; suggested: number;
  supplier_id: number | null; supplier: string | null; last_price: number | null; preferred: boolean;
}

/**
 * Necesarul de comandat pentru locațiile date:
 *  - produsele sub stocul minim, până la nivelul țintă;
 *  - materiile prime pentru planurile de producție neînregistrate din următoarele `days` zile (din rețete),
 *    astfel încât după producție să rămână cel puțin stocul minim.
 * Furnizorul: cel ales în Stocuri minime, altfel ultimul furnizor din facturi (cu prioritate furnizorii locației).
 */
export async function needs(locationIds: number[], days = 3): Promise<NeedRow[]> {
  if (!locationIds.length) return [];
  return q<NeedRow>(
    `WITH st AS (SELECT location_id, product_id, sum(qty) qty FROM stock_movements WHERE location_id = ANY($1::int[]) GROUP BY 1, 2),
          prod AS (
            SELECT o.location_id, i.ingredient_id product_id, sum(i.qty * pl.planned_qty / r.yield_qty) need
              FROM production_orders o JOIN production_lines pl ON pl.order_id = o.id
              JOIN recipes r ON r.product_id = pl.product_id AND r.active JOIN recipe_items i ON i.recipe_id = r.id
             WHERE o.status = 'planned' AND o.planned_for BETWEEN current_date AND current_date + $2::int AND o.location_id = ANY($1::int[])
             GROUP BY 1, 2),
          cand AS (SELECT location_id, product_id FROM stock_targets WHERE location_id = ANY($1::int[]) UNION SELECT location_id, product_id FROM prod),
          calc AS (
            SELECT c.location_id, c.product_id, coalesce(st.qty, 0) stock, t.min_qty, t.target_qty, coalesce(prod.need, 0) need, t.supplier_id,
                   greatest(
                     CASE WHEN t.product_id IS NOT NULL AND coalesce(st.qty, 0) < t.min_qty THEN t.target_qty - coalesce(st.qty, 0) ELSE 0 END,
                     CASE WHEN coalesce(prod.need, 0) > 0 THEN prod.need + coalesce(t.min_qty, 0) - coalesce(st.qty, 0) ELSE 0 END,
                     0) suggested
              FROM cand c
              LEFT JOIN st ON st.location_id = c.location_id AND st.product_id = c.product_id
              LEFT JOIN stock_targets t ON t.location_id = c.location_id AND t.product_id = c.product_id
              LEFT JOIN prod ON prod.location_id = c.location_id AND prod.product_id = c.product_id)
     SELECT calc.location_id, l.name location, p.id product_id, p.name product, p.unit,
            calc.stock::float8 stock, calc.min_qty::float8 min_qty, calc.target_qty::float8 target_qty, round(calc.need, 3)::float8 production_need,
            (ceil(calc.suggested * 100) / 100)::float8 suggested,
            sup.id supplier_id, sup.name supplier, p.cost_price::float8 last_price,
            EXISTS (SELECT 1 FROM location_suppliers ls WHERE ls.location_id = calc.location_id AND ls.supplier_id = sup.id) preferred
       FROM calc JOIN products p ON p.id = calc.product_id JOIN locations l ON l.id = calc.location_id
       LEFT JOIN LATERAL (
         SELECT s.id, s.name FROM suppliers s
          WHERE s.id = coalesce(calc.supplier_id, (
            SELECT h.supplier_id FROM price_history h WHERE h.product_id = p.id AND h.supplier_id IS NOT NULL
             ORDER BY EXISTS (SELECT 1 FROM location_suppliers ls WHERE ls.location_id = calc.location_id AND ls.supplier_id = h.supplier_id) DESC,
                      h.price_date DESC, h.id DESC LIMIT 1))) sup ON true
      WHERE calc.suggested > 0
      ORDER BY l.id, sup.name NULLS LAST, p.name`,
    [locationIds, days],
  );
}

/** Propunerile de comandă pentru o locație (folosite la „Creează comanda”). */
export async function suggestions(locationId: number, days = 3) {
  return needs([locationId], days);
}

/** Furnizorii obișnuiți ai locațiilor, pentru filtre și pentru lista din formularul de comandă. */
export async function locationSuppliers(locationIds: number[]) {
  return q<{ location_id: number; supplier_id: number; name: string; email: string | null; phone: string | null }>(
    `SELECT ls.location_id, s.id supplier_id, s.name, s.email, s.phone FROM location_suppliers ls JOIN suppliers s ON s.id = ls.supplier_id
      WHERE ls.location_id = ANY($1::int[]) ORDER BY s.name`,
    [locationIds],
  );
}

export async function listPurchaseOrders(user: SessionUser, status: string) {
  const params: unknown[] = [];
  const where = ["TRUE"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`o.location_id = ANY($${params.length}::int[])`); }
  if (status === "open") where.push("o.status IN ('draft','sent')");
  else if (status !== "all") { params.push(status); where.push(`o.status = $${params.length}`); }
  return q<{ id: number; supplier: string; location: string; status: string; needed_for: string | null; lines: number; est_total: number; created_at: string; author: string; invoice_id: number | null }>(
    `SELECT o.id, s.name supplier, l.name location, o.status, o.needed_for::text needed_for, count(pl.id)::int lines,
            coalesce(sum(pl.qty * pl.est_price), 0)::float8 est_total, o.created_at, u.name author, o.invoice_id
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN locations l ON l.id = o.location_id
       JOIN users u ON u.id = o.created_by LEFT JOIN purchase_order_lines pl ON pl.order_id = o.id
      WHERE ${where.join(" AND ")}
      GROUP BY o.id, s.name, l.name, u.name
      ORDER BY CASE o.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, o.created_at DESC LIMIT 200`,
    params,
  );
}

export async function getPurchaseOrder(user: SessionUser, id: number) {
  const o = await one<{ id: number; supplier_id: number; supplier: string; supplier_email: string | null; supplier_phone: string | null; cif: string | null;
    location_id: number; location: string; status: string; needed_for: string | null; note: string | null; author: string; created_at: string;
    sent_at: string | null; sent_via: string | null; delivered_at: string | null; invoice_id: number | null; invoice_number: string | null }>(
    `SELECT o.id, o.supplier_id, s.name supplier, s.email supplier_email, s.phone supplier_phone, s.cif, o.location_id, l.name location, o.status,
            o.needed_for::text needed_for, o.note, u.name author, o.created_at, o.sent_at, o.sent_via, o.delivered_at, o.invoice_id, i.number invoice_number
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN locations l ON l.id = o.location_id
       JOIN users u ON u.id = o.created_by LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.id = $1`,
    [id],
  );
  if (!o || (user.locationIds !== null && !user.locationIds.includes(o.location_id))) return null;
  // Cantitatea facturată pe produs (din factura legată), în unitatea de bază a produsului.
  const lines = await q<{ id: number; product_id: number; product: string; unit: string; qty: number; est_price: number | null; received_qty: number | null; note: string | null; invoiced_qty: number | null; invoiced_net: number | null }>(
    `SELECT pl.id, p.id product_id, p.name product, coalesce(pl.unit, p.unit) unit, pl.qty::float8 qty, pl.est_price::float8 est_price,
            pl.received_qty::float8 received_qty, pl.note,
            (SELECT sum(il.qty * il.factor)::float8 FROM invoice_lines il WHERE il.invoice_id = $2 AND il.product_id = p.id) invoiced_qty,
            (SELECT sum(il.net)::float8 FROM invoice_lines il WHERE il.invoice_id = $2 AND il.product_id = p.id) invoiced_net
       FROM purchase_order_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.order_id = $1 ORDER BY p.name`,
    [id, o.invoice_id],
  );
  return { ...o, lines };
}

/** Facturile verificate ale furnizorului din jurul datei comenzii, pentru legarea comenzii de factură. */
export async function candidateInvoices(supplierId: number, around: string) {
  return q<{ id: number; number: string; issue_date: string; total_net: number }>(
    `SELECT id, number, issue_date::text issue_date, total_net::float8 total_net FROM invoices
      WHERE supplier_id = $1 AND status <> 'cancelled' AND issue_date BETWEEN $2::date - 7 AND $2::date + 21
      ORDER BY issue_date`,
    [supplierId, around],
  );
}
