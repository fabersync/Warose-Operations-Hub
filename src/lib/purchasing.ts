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

/**
 * Propunerile de comandă pentru o locație: produsele cu stoc sub minim (Stocuri minime),
 * cu cantitatea până la nivelul țintă și furnizorul obișnuit (ultimul de pe facturi).
 */
export async function suggestions(locationId: number) {
  return q<{ product_id: number; product: string; unit: string; stock: number; min_qty: number; target_qty: number; suggested: number; supplier_id: number | null; supplier: string | null; last_price: number | null }>(
    `SELECT p.id product_id, p.name product, p.unit,
            coalesce(st.qty, 0)::float8 stock, t.min_qty::float8 min_qty, t.target_qty::float8 target_qty,
            greatest(t.target_qty - coalesce(st.qty, 0), 0)::float8 suggested,
            ls.supplier_id, s.name supplier, p.cost_price::float8 last_price
       FROM stock_targets t
       JOIN products p ON p.id = t.product_id
       LEFT JOIN (SELECT product_id, sum(qty) qty FROM stock_movements WHERE location_id = $1 GROUP BY product_id) st ON st.product_id = p.id
       LEFT JOIN LATERAL (SELECT supplier_id FROM price_history h WHERE h.product_id = p.id ORDER BY price_date DESC, id DESC LIMIT 1) ls ON true
       LEFT JOIN suppliers s ON s.id = ls.supplier_id
      WHERE t.location_id = $1 AND coalesce(st.qty, 0) < t.min_qty
      ORDER BY s.name NULLS LAST, p.name`,
    [locationId],
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
