import "server-only";
import { q } from "./db";
import { addDays, fmtDate } from "./format";

const MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
export const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export interface DailyReport {
  date: string;
  locations: { id: number; name: string; net: number; receipts: number; prevWeek: number; avg4: number; lastSale: string | null }[];
  top: { name: string; qty: number; net: number }[];
  ops: { ordersDue: number; ordersToConfirm: number; inTransit: number; invoicesDraft: number; productionToApprove: number; proofing: { location: string; status: string }[] };
  alerts: { severity: string; title: string; link: string | null }[];
}

/** Raportul zilei precedente: vânzări pe locații (vs. aceeași zi de săptămâna trecută și media ultimelor 4), ce urmează azi, alerte. */
export async function buildDailyReport(today: string): Promise<DailyReport> {
  const day = addDays(today, -1);
  const locations = await q<DailyReport["locations"][number]>(
    `SELECT l.id, l.name,
            coalesce((SELECT sum(net) FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date = $1), 0)::float8 net,
            (SELECT count(DISTINCT receipt_no) FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date = $1)::int receipts,
            coalesce((SELECT sum(net) FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date = $1::date - 7), 0)::float8 "prevWeek",
            coalesce((SELECT sum(net) / 4 FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date IN ($1::date - 7, $1::date - 14, $1::date - 21, $1::date - 28)), 0)::float8 avg4,
            (SELECT to_char(max(sold_at), 'YYYY-MM-DD HH24:MI') FROM sales_lines s WHERE s.location_id = l.id) "lastSale"
       FROM locations l WHERE l.kind = 'store' AND l.active ORDER BY l.id`, [day]);
  const top = await q<DailyReport["top"][number]>(
    `SELECT product_name name, sum(qty)::float8 qty, sum(net)::float8 net FROM sales_lines
      WHERE sold_date = $1 AND coalesce(item_type,'') <> 'Ambalaje SGR' GROUP BY product_name ORDER BY 3 DESC LIMIT 8`, [day]);
  const [ops] = await q<Omit<DailyReport["ops"], "proofing">>(
    `SELECT (SELECT count(*) FROM location_orders WHERE status IN ('submitted','confirmed','preparing') AND needed_for <= $1)::int "ordersDue",
            (SELECT count(*) FROM location_orders WHERE status = 'submitted')::int "ordersToConfirm",
            (SELECT count(*) FROM location_orders WHERE status = 'shipped')::int "inTransit",
            (SELECT count(*) FROM invoices WHERE status = 'draft')::int "invoicesDraft",
            (SELECT count(*) FROM production_orders WHERE status = 'recorded')::int "productionToApprove"`, [today]);
  const proofing = await q<{ location: string; status: string }>(
    `SELECT l.name location, coalesce(p.status, 'lipsă') status FROM locations l
       LEFT JOIN proofing_plans p ON p.location_id = l.id AND p.plan_date = $1 AND p.status <> 'cancelled'
      WHERE l.kind = 'store' AND l.active ORDER BY l.id`, [today]);
  const alerts = await q<DailyReport["alerts"][number]>(
    `SELECT severity, title, link FROM alert_state WHERE resolved_at IS NULL
      ORDER BY CASE severity WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, first_seen LIMIT 15`);
  return { date: day, locations, top, ops: { ...ops, proofing }, alerts };
}

export interface MonthlyReport {
  month: string;
  locations: { id: number; name: string; revenue: number; prevRevenue: number; costs: number; materials: number }[];
  top: { name: string; qty: number; net: number }[];
  invoices: { count: number; net: number };
  inventory: { counts: number; value: number };
  production: { orders: number; qty: number };
  orders: { received: number; shortfall: number };
}

/** Raportul lunii încheiate: vânzări vs. luna anterioară, costuri și rezultat estimat pe locații, activitate. */
export async function buildMonthlyReport(month: string): Promise<MonthlyReport> {
  const from = `${month}-01`;
  const locations = await q<MonthlyReport["locations"][number]>(
    `SELECT l.id, l.name,
            coalesce((SELECT sum(net) FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date >= $1::date AND s.sold_date < $1::date + interval '1 month'), 0)::float8 revenue,
            coalesce((SELECT sum(net) FROM sales_lines s WHERE s.location_id = l.id AND s.sold_date >= $1::date - interval '1 month' AND s.sold_date < $1::date), 0)::float8 "prevRevenue",
            coalesce((SELECT sum(amount_net) FROM cost_entries e WHERE e.location_id = l.id AND e.entry_date >= $1::date AND e.entry_date < $1::date + interval '1 month'), 0)::float8 costs,
            coalesce((SELECT sum(amount_net) FROM cost_entries e JOIN expense_categories c ON c.id = e.category_id
                       WHERE c.name = 'Materii Prime' AND e.location_id = l.id AND e.entry_date >= $1::date AND e.entry_date < $1::date + interval '1 month'), 0)::float8 materials
       FROM locations l WHERE l.active AND l.kind <> 'freezer' ORDER BY l.kind = 'store' DESC, l.id`, [from]);
  const top = await q<MonthlyReport["top"][number]>(
    `SELECT product_name name, sum(qty)::float8 qty, sum(net)::float8 net FROM sales_lines
      WHERE sold_date >= $1::date AND sold_date < $1::date + interval '1 month' AND coalesce(item_type,'') <> 'Ambalaje SGR'
      GROUP BY product_name ORDER BY 3 DESC LIMIT 10`, [from]);
  const [x] = await q<{ inv_count: number; inv_net: number; inv_counts: number; inv_value: number; prod_orders: number; prod_qty: number; ord_received: number; ord_short: number }>(
    `SELECT (SELECT count(*) FROM invoices WHERE status = 'verified' AND issue_date >= $1::date AND issue_date < $1::date + interval '1 month')::int inv_count,
            coalesce((SELECT sum(total_net) FROM invoices WHERE status = 'verified' AND issue_date >= $1::date AND issue_date < $1::date + interval '1 month'), 0)::float8 inv_net,
            (SELECT count(*) FROM inventory_counts WHERE status = 'closed' AND as_of >= $1::date AND as_of < $1::date + interval '1 month')::int inv_counts,
            coalesce((SELECT sum(posted_value) FROM inventory_counts WHERE status = 'closed' AND as_of >= $1::date AND as_of < $1::date + interval '1 month'), 0)::float8 inv_value,
            (SELECT count(*) FROM production_orders WHERE status = 'approved' AND planned_for >= $1::date AND planned_for < $1::date + interval '1 month')::int prod_orders,
            coalesce((SELECT sum(pl.produced_qty) FROM production_orders o JOIN production_lines pl ON pl.order_id = o.id
                       WHERE o.status = 'approved' AND o.planned_for >= $1::date AND o.planned_for < $1::date + interval '1 month'), 0)::float8 prod_qty,
            (SELECT count(*) FROM location_orders WHERE status = 'received' AND received_at >= $1::date AND received_at < $1::date + interval '1 month')::int ord_received,
            coalesce((SELECT sum(l.ordered_qty - coalesce(l.received_qty, 0)) FROM location_orders o JOIN location_order_lines l ON l.order_id = o.id
                       WHERE o.status = 'received' AND o.received_at >= $1::date AND o.received_at < $1::date + interval '1 month'), 0)::float8 ord_short`, [from]);
  return {
    month, locations, top,
    invoices: { count: x.inv_count, net: x.inv_net },
    inventory: { counts: x.inv_counts, value: x.inv_value },
    production: { orders: x.prod_orders, qty: x.prod_qty },
    orders: { received: x.ord_received, shortfall: x.ord_short },
  };
}

const ron = (v: number) => new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 }).format(v);
const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "—");
const td = "padding:8px 6px;border-bottom:1px solid #eee;font-size:14px";

export function dailyEmailRows(r: DailyReport) {
  const loc = r.locations.map((l) => `<tr><td style="${td}">${l.name}</td><td style="${td};text-align:right"><b>${ron(l.net)}</b></td><td style="${td};text-align:right;color:#7c766d">${pct(l.net, l.prevWeek)} vs. săpt. trecută</td></tr>`).join("");
  const top = r.top.slice(0, 5).map((t) => `<tr><td style="${td}">${t.name}</td><td style="${td};text-align:right">${t.qty} buc</td><td style="${td};text-align:right">${ron(t.net)}</td></tr>`).join("");
  const al = r.alerts.length ? `<p style="margin:16px 0 6px;font-weight:600">Alerte active (${r.alerts.length})</p><ul style="margin:0;padding-left:18px;font-size:14px">${r.alerts.slice(0, 8).map((a) => `<li>${a.title}</li>`).join("")}</ul>` : `<p style="margin:16px 0 0;font-size:14px;color:#2e7a57">Nicio alertă activă.</p>`;
  return `<p style="margin:0 0 6px;font-weight:600">Vânzări nete ${fmtDate(r.date)}</p><table style="width:100%;border-collapse:collapse">${loc}</table>
<p style="margin:16px 0 6px;font-weight:600">Cele mai vândute</p><table style="width:100%;border-collapse:collapse">${top || `<tr><td style="${td}">Fără vânzări importate.</td></tr>`}</table>
<p style="margin:16px 0 6px;font-weight:600">Azi</p><p style="margin:0;font-size:14px">${r.ops.ordersDue} comenzi de livrat · ${r.ops.ordersToConfirm} de confirmat · ${r.ops.inTransit} în tranzit · ${r.ops.invoicesDraft} facturi de verificat · ${r.ops.productionToApprove} producții de aprobat</p>${al}`;
}

export function monthlyEmailRows(r: MonthlyReport) {
  const rows = r.locations.map((l) => `<tr><td style="${td}">${l.name}</td><td style="${td};text-align:right">${ron(l.revenue)}</td><td style="${td};text-align:right">${ron(l.costs)}</td><td style="${td};text-align:right"><b>${ron(l.revenue - l.costs)}</b></td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse"><tr><th style="${td};text-align:left">Locație</th><th style="${td};text-align:right">Vânzări</th><th style="${td};text-align:right">Costuri</th><th style="${td};text-align:right">Rezultat estimat</th></tr>${rows}</table>
<p style="margin:16px 0 0;font-size:14px">${r.invoices.count} facturi verificate (${ron(r.invoices.net)} fără TVA) · ${r.production.orders} documente de producție · ${r.inventory.counts} inventare · ${r.orders.received} comenzi recepționate</p>
<p style="margin:8px 0 0;font-size:12px;color:#7c766d">Rezultat estimat = vânzări Publine − costuri introduse în aplicație. Nu este profitul contabil.</p>`;
}
