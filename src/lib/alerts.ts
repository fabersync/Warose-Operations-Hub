import "server-only";
import { q } from "./db";
import { getSetting } from "./invoices";
import { addDays, fmtDate } from "./format";
import type { Role } from "./auth";

export type Severity = "info" | "warn" | "bad";

export interface Alert {
  key: string;          // stabilă: aceeași situație → aceeași cheie (fără notificări repetate)
  severity: Severity;
  title: string;
  detail?: string;
  link: string;
  roles: Role[];        // cine trebuie anunțat (administratorul primește tot)
  locationId?: number | null;
}

export interface AutomationSettings {
  daily_report_time: string;
  monthly_report_time: string;
  alerts_every_min: number;
  agent_offline_min: number;
  business_from: number;
  business_to: number;
}

export const DEFAULT_AUTOMATION: AutomationSettings = {
  daily_report_time: "07:30", monthly_report_time: "08:00", alerts_every_min: 15, agent_offline_min: 45, business_from: 7, business_to: 20,
};

/** Data, ora și minutul curente în ora României. */
export function nowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

const n = (v: number) => new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(v);

/**
 * Regulile de alertă. Fiecare regulă citește starea curentă din baza de date; nu există alerte „inventate”.
 * Alertele care nu mai apar la rularea următoare sunt marcate rezolvate.
 */
export async function computeAlerts(): Promise<Alert[]> {
  const cfg = { ...DEFAULT_AUTOMATION, ...(await getSetting<Partial<AutomationSettings>>("automation", {})) };
  const now = nowLocal();
  const inBusiness = now.hour >= cfg.business_from && now.hour < cfg.business_to;
  const tomorrow = addDays(now.date, 1);
  const alerts: Alert[] = [];

  // 1. Agenții de sincronizare Publine care nu mai trimit semnal (doar în programul locațiilor).
  if (inBusiness) {
    for (const a of await q<{ id: number; name: string; location: string; location_id: number; minutes: number | null }>(
      `SELECT a.id, a.name, l.name location, a.location_id, (extract(epoch FROM now() - a.last_seen_at) / 60)::int minutes
         FROM sync_agents a JOIN locations l ON l.id = a.location_id
        WHERE a.active AND (a.last_seen_at IS NULL OR a.last_seen_at < now() - make_interval(mins => $1))`, [cfg.agent_offline_min])) {
      alerts.push({ key: `agent_offline:${a.id}`, severity: "bad", title: `Agentul Publine din ${a.location} nu răspunde`,
        detail: a.minutes == null ? `„${a.name}” nu a trimis niciodată semnal.` : `„${a.name}” — ultimul semnal acum ${a.minutes} minute. Vânzările nu se mai sincronizează.`,
        link: "/importuri", roles: ["admin"], locationId: a.location_id });
    }
  }

  // 2. Importuri eșuate sau nereconciliate.
  for (const b of await q<{ id: number; file_name: string; status: string; reconciled: boolean | null; error: string | null }>(
    `SELECT id, file_name, status, reconciled, error FROM import_batches
      WHERE (status = 'failed' OR (status = 'done' AND reconciled = false)) AND created_at > now() - interval '30 days'`)) {
    alerts.push({ key: `import:${b.id}`, severity: b.status === "failed" ? "bad" : "warn",
      title: b.status === "failed" ? `Import eșuat: ${b.file_name}` : `Import cu totaluri nereconciliate: ${b.file_name}`,
      detail: b.error ?? "Totalul din fișier diferă de totalul înregistrat.", link: "/importuri", roles: ["admin", "accounting"] });
  }

  // 3. Magazine fără vânzări importate ieri, deși au avut vânzări în ultima săptămână.
  if (now.hour >= 9) {
    for (const l of await q<{ id: number; name: string; last: string }>(
      `SELECT l.id, l.name, max(s.sold_date)::text last FROM locations l JOIN sales_lines s ON s.location_id = l.id
        WHERE l.kind = 'store' AND l.active GROUP BY l.id
       HAVING max(s.sold_date) < $1::date - 1 AND max(s.sold_date) >= $1::date - 8`, [now.date])) {
      alerts.push({ key: `no_sales:${l.id}:${now.date}`, severity: "warn", title: `Nicio vânzare importată ieri pentru ${l.name}`,
        detail: `Ultimele vânzări sunt din ${fmtDate(l.last)}. Verificați exportul Publine și agentul.`, link: "/importuri", roles: ["admin", "location_manager"], locationId: l.id });
    }
  }

  // 4. Stoc operațional negativ.
  for (const s of await q<{ location_id: number; location: string; product: string; unit: string; qty: number }>(
    `SELECT m.location_id, l.name location, p.name product, p.unit, sum(m.qty)::float8 qty
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
      GROUP BY m.location_id, l.name, p.id HAVING sum(m.qty) < -0.0005`)) {
    alerts.push({ key: `negative_stock:${s.location_id}:${s.product}`, severity: "warn", title: `Stoc negativ: ${s.product} în ${s.location}`,
      detail: `${n(s.qty)} ${s.unit}. Lipsesc recepții sau transferuri în evidență.`, link: `/stocuri?loc=${s.location_id}`, roles: ["admin", "production", "location_manager"], locationId: s.location_id });
  }

  // 5. Loturi care expiră în cel mult 3 zile sau au expirat, încă în stoc.
  for (const l of await q<{ location_id: number; location: string; product: string; lot: string | null; expires_on: string; qty: number; unit: string }>(
    `SELECT m.location_id, l.name location, p.name product, m.lot, min(m.expires_on) FILTER (WHERE m.qty > 0)::text expires_on, sum(m.qty)::float8 qty, p.unit
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
      GROUP BY m.location_id, l.name, p.id, m.lot
     HAVING sum(m.qty) > 0 AND min(m.expires_on) FILTER (WHERE m.qty > 0) <= $1::date + 3`, [now.date])) {
    const expired = l.expires_on < now.date;
    alerts.push({ key: `expiry:${l.location_id}:${l.product}:${l.lot ?? "-"}`, severity: expired ? "bad" : "warn",
      title: `${expired ? "Lot expirat" : "Lot aproape de expirare"}: ${l.product}${l.lot ? ` (${l.lot})` : ""}`,
      detail: `${n(l.qty)} ${l.unit} în ${l.location}, expiră ${fmtDate(l.expires_on)}.`, link: "/congelator", roles: ["admin", "production", "location_manager"], locationId: l.location_id });
  }

  // 6. Comenzi ale locațiilor care așteaptă.
  for (const o of await q<{ id: number; status: string; from_name: string; to_id: number; from_id: number; needed_for: string; hours: number }>(
    `SELECT o.id, o.status, f.name from_name, o.to_location_id to_id, o.from_location_id from_id, o.needed_for::text needed_for,
            (extract(epoch FROM now() - coalesce(o.shipped_at, o.submitted_at)) / 3600)::int hours
       FROM location_orders o JOIN locations f ON f.id = o.from_location_id
      WHERE (o.status = 'submitted' AND o.submitted_at < now() - interval '2 hours')
         OR (o.status IN ('submitted','confirmed','preparing') AND o.needed_for <= $1::date)
         OR (o.status = 'shipped' AND o.shipped_at < now() - interval '24 hours')`, [tomorrow])) {
    if (o.status === "shipped") {
      alerts.push({ key: `order_receive:${o.id}`, severity: "warn", title: `Comanda #${o.id} expediată, nerecepționată de ${o.hours} ore`,
        detail: `${o.from_name} trebuie să confirme recepția.`, link: `/comenzi/${o.id}`, roles: ["admin", "location_manager"], locationId: o.from_id });
    } else if (o.needed_for <= tomorrow) {
      alerts.push({ key: `order_due:${o.id}`, severity: "bad", title: `Comanda #${o.id} pentru ${o.from_name} trebuie livrată până ${fmtDate(o.needed_for)}`,
        detail: `Stare: ${o.status === "submitted" ? "neconfirmată" : o.status === "confirmed" ? "confirmată, nepregătită" : "în pregătire"}.`, link: `/comenzi/${o.id}`, roles: ["admin", "production"], locationId: o.to_id });
    } else {
      alerts.push({ key: `order_confirm:${o.id}`, severity: "warn", title: `Comanda #${o.id} de la ${o.from_name} așteaptă confirmare`,
        detail: `Trimisă de ${o.hours} ore.`, link: `/comenzi/${o.id}`, roles: ["admin", "production"], locationId: o.to_id });
    }
  }

  // 7. Plan de dospire neconfirmat pentru mâine (după ora 17).
  if (now.hour >= 17) {
    for (const l of await q<{ id: number; name: string; status: string | null }>(
      `SELECT l.id, l.name, p.status FROM locations l
         LEFT JOIN proofing_plans p ON p.location_id = l.id AND p.plan_date = $1 AND p.status <> 'cancelled'
        WHERE l.kind = 'store' AND l.active AND coalesce(p.status, '') <> 'confirmed'`, [tomorrow])) {
      alerts.push({ key: `proofing:${l.id}:${tomorrow}`, severity: "warn", title: `Plan de dospire neconfirmat pentru mâine — ${l.name}`,
        detail: l.status ? "Planul este încă ciornă." : "Nu există plan.", link: `/dospire?loc=${l.id}&d=${tomorrow}`, roles: ["admin", "location_manager", "production"], locationId: l.id });
    }
  }

  // 8. Producție înregistrată, neaprobată de peste o zi; producție aprobată neintrodusă în SAGA de peste 7 zile.
  for (const p of await q<{ id: number; status: string; planned_for: string }>(
    `SELECT id, status, planned_for::text planned_for FROM production_orders
      WHERE (status = 'recorded' AND recorded_at < now() - interval '24 hours')
         OR (status = 'approved' AND saga_doc_no IS NULL AND approved_at < now() - interval '7 days')`)) {
    alerts.push(p.status === "recorded"
      ? { key: `production_approve:${p.id}`, severity: "warn", title: `Producția #${p.id} din ${fmtDate(p.planned_for)} așteaptă aprobare`, link: `/productie/${p.id}`, roles: ["admin", "production"] }
      : { key: `production_saga:${p.id}`, severity: "info", title: `Producția #${p.id} nu este marcată ca introdusă în SAGA`, link: `/productie/${p.id}`, roles: ["admin", "production", "accounting"] });
  }

  // 9. Facturi: neverificate de peste 3 zile; verificate dar neintroduse în SAGA de peste 7 zile.
  const inv = (await q<{ drafts: number; saga: number }>(
    `SELECT count(*) FILTER (WHERE status = 'draft' AND created_at < now() - interval '3 days')::int drafts,
            count(*) FILTER (WHERE status = 'verified' AND saga_registered_at IS NULL AND verified_at < now() - interval '7 days')::int saga
       FROM invoices`))[0];
  if (inv.drafts) alerts.push({ key: "invoices_unverified", severity: "warn", title: `${inv.drafts} facturi neverificate de peste 3 zile`, link: "/facturi?s=draft", roles: ["admin", "accounting"] });
  if (inv.saga) alerts.push({ key: "invoices_saga", severity: "info", title: `${inv.saga} facturi verificate nu sunt marcate în SAGA`, link: "/facturi?s=saga", roles: ["admin", "accounting"] });

  // 10. Creșteri de preț de achiziție de cel puțin 10% în ultimele 7 zile.
  for (const p of await q<{ product_id: number; name: string; unit: string; last: number; prev: number; invoice_id: number }>(
    `SELECT h.product_id, p.name, p.unit, h.unit_cost::float8 last, h.invoice_id,
            (SELECT h2.unit_cost::float8 FROM price_history h2 WHERE h2.product_id = h.product_id AND (h2.price_date, h2.id) < (h.price_date, h.id)
              ORDER BY h2.price_date DESC, h2.id DESC LIMIT 1) prev
       FROM price_history h JOIN products p ON p.id = h.product_id
      WHERE h.price_date >= $1::date - 7`, [now.date])) {
    if (!p.prev || p.last < p.prev * 1.1) continue;
    alerts.push({ key: `price_up:${p.product_id}:${p.invoice_id}`, severity: "info", title: `Preț în creștere: ${p.name} +${Math.round(((p.last - p.prev) / p.prev) * 100)}%`,
      detail: `${n(p.prev)} → ${n(p.last)} lei/${p.unit}.`, link: `/facturi/${p.invoice_id}`, roles: ["admin", "accounting", "production"] });
  }

  return alerts;
}
