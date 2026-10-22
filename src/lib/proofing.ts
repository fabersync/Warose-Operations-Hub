import "server-only";
import { one, q } from "./db";
import type { SessionUser } from "./auth";

/** Cine poate crea și confirma planuri. Personalul operațional doar bifează sarcinile. */
export const canPlanProofing = (u: SessionUser) => ["admin", "production", "location_manager"].includes(u.role);
export const canConfigureProofing = (u: SessionUser) => ["admin", "production"].includes(u.role);

export type TaskKind = "thaw" | "proof" | "bake";

export interface PlanItem {
  id: number;
  product_id: number;
  product: string;
  unit: string;
  qty: number;
  suggested_qty: number | null;
  thaw: number | null;
  proof: number | null;
  bake: number | null;
  validated: boolean;
  done: Record<TaskKind, { at: string | null; by: string | null }>;
  stock_location: number;
  stock_depot: number;
}

export interface Task {
  itemId: number;
  kind: TaskKind;
  product: string;
  qty: number;
  unit: string;
  offset: number; // minute față de miezul nopții din ziua planului (negativ = seara dinainte)
  label: string;
  doneAt: string | null;
  doneBy: string | null;
}

export interface Warning { tone: "bad" | "warn" | "info"; text: string }

const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** Ora din ziua planului (sau din seara precedentă) ca text „joi 22:30”. */
export function fmtOffset(planDate: string, offset: number) {
  const [y, m, d] = planDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, offset));
  const day = new Intl.DateTimeFormat("ro-RO", { weekday: "short", timeZone: "UTC" }).format(dt);
  return `${day} ${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;
}

/** Minutele „acum” raportate la miezul nopții din ziua planului, în ora României. */
export function nowOffset(planDate: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const now = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const [y, m, d] = planDate.split("-").map(Number);
  return Math.round((now - Date.UTC(y, m - 1, d)) / 60000);
}

export async function locationSettings(locationId: number) {
  return (await one<{ ready_time: string; capacity: number | null }>(
    "SELECT ready_time::text ready_time, capacity FROM proofing_settings WHERE location_id=$1", [locationId],
  )) ?? { ready_time: "05:00:00", capacity: null };
}

export async function getPlan(locationId: number, date: string) {
  const plan = await one<{ id: number; status: "draft" | "confirmed"; ready_time: string; note: string | null; author: string; confirmed_by: string | null; confirmed_at: string | null }>(
    `SELECT p.id, p.status, p.ready_time::text ready_time, p.note, u.name author, cu.name confirmed_by, p.confirmed_at
       FROM proofing_plans p JOIN users u ON u.id = p.created_by LEFT JOIN users cu ON cu.id = p.confirmed_by
      WHERE p.location_id=$1 AND p.plan_date=$2 AND p.status <> 'cancelled'`,
    [locationId, date],
  );
  if (!plan) return null;
  const rows = await q<any>(
    `SELECT i.id, i.product_id, pr.name product, pr.unit, i.qty::float8 qty, i.suggested_qty::float8 suggested_qty,
            -- în ciornă se folosesc duratele curente; după confirmare, cele fixate pe linie
            CASE WHEN $2 = 'confirmed' THEN i.thaw_minutes ELSE c.thaw_minutes END thaw,
            CASE WHEN $2 = 'confirmed' THEN i.proof_minutes ELSE c.proof_minutes END proof,
            CASE WHEN $2 = 'confirmed' THEN i.bake_minutes ELSE c.bake_minutes END bake,
            coalesce(c.validated, false) validated,
            i.thaw_done_at, tu.name thaw_by, i.proof_done_at, pu.name proof_by, i.bake_done_at, bu.name bake_by,
            coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id = $3 AND m.product_id = i.product_id), 0)::float8 stock_location,
            coalesce((SELECT sum(m.qty) FROM stock_movements m JOIN locations l ON l.id = m.location_id
                       WHERE l.kind = 'freezer' AND m.product_id = i.product_id), 0)::float8 stock_depot
       FROM proofing_items i JOIN products pr ON pr.id = i.product_id
       LEFT JOIN product_proofing c ON c.product_id = i.product_id
       LEFT JOIN users tu ON tu.id = i.thaw_done_by LEFT JOIN users pu ON pu.id = i.proof_done_by LEFT JOIN users bu ON bu.id = i.bake_done_by
      WHERE i.plan_id = $1 ORDER BY pr.name`,
    [plan.id, plan.status, locationId],
  );
  const items: PlanItem[] = rows.map((r) => ({
    id: r.id, product_id: r.product_id, product: r.product, unit: r.unit, qty: r.qty, suggested_qty: r.suggested_qty,
    thaw: r.thaw, proof: r.proof, bake: r.bake, validated: r.validated,
    done: { thaw: { at: r.thaw_done_at, by: r.thaw_by }, proof: { at: r.proof_done_at, by: r.proof_by }, bake: { at: r.bake_done_at, by: r.bake_by } },
    stock_location: r.stock_location, stock_depot: r.stock_depot,
  }));
  return { ...plan, items };
}

/**
 * Calculează sarcinile (ora de scoatere din congelator, de intrare în dospitor și la cuptor),
 * pornind înapoi de la ora la care produsele trebuie să fie gata.
 */
export function schedule(date: string, readyTime: string, items: PlanItem[]) {
  const ready = hm(readyTime);
  const tasks: Task[] = [];
  for (const it of items) {
    if (it.proof == null) continue;
    const bakeAt = ready - (it.bake ?? 0);
    const proofAt = bakeAt - it.proof;
    const thawAt = proofAt - (it.thaw ?? 0);
    const base = { itemId: it.id, product: it.product, qty: it.qty, unit: it.unit };
    if ((it.thaw ?? 0) > 0) {
      tasks.push({ ...base, kind: "thaw", offset: thawAt, label: `Scoate din congelator pentru decongelare (${it.thaw} min)`, doneAt: it.done.thaw.at, doneBy: it.done.thaw.by });
      tasks.push({ ...base, kind: "proof", offset: proofAt, label: `Introdu în dospitor (${it.proof} min)`, doneAt: it.done.proof.at, doneBy: it.done.proof.by });
    } else {
      tasks.push({ ...base, kind: "proof", offset: proofAt, label: `Scoate din congelator și introdu în dospitor (${it.proof} min)`, doneAt: it.done.proof.at, doneBy: it.done.proof.by });
    }
    if ((it.bake ?? 0) > 0) tasks.push({ ...base, kind: "bake", offset: bakeAt, label: `Introdu la cuptor (${it.bake} min)`, doneAt: it.done.bake.at, doneBy: it.done.bake.by });
  }
  return tasks.sort((a, b) => a.offset - b.offset || a.product.localeCompare(b.product));
}

export function planWarnings(date: string, status: string, readyTime: string, items: PlanItem[], capacity: number | null): Warning[] {
  const w: Warning[] = [];
  const missing = items.filter((i) => i.proof == null);
  if (missing.length) w.push({ tone: "bad", text: `Fără durate configurate: ${missing.map((i) => i.product).join(", ")}. Nu se pot calcula orele.` });
  const unvalidated = items.filter((i) => i.proof != null && !i.validated);
  if (unvalidated.length) w.push({ tone: "info", text: `Durate nevalidate (ore orientative): ${unvalidated.map((i) => i.product).join(", ")}.` });

  for (const i of items) {
    if (i.qty <= i.stock_location + 1e-9) continue;
    const need = i.qty - Math.max(i.stock_location, 0);
    if (i.stock_depot + 1e-9 >= need) w.push({ tone: "warn", text: `${i.product}: în locație sunt ${fmt(i.stock_location)} ${i.unit}, planul cere ${fmt(i.qty)}. Trebuie aduse ${fmt(need)} ${i.unit} din depozitul de congelate (disponibil ${fmt(i.stock_depot)}).` });
    else w.push({ tone: "bad", text: `${i.product}: nu poate fi pregătit integral — lipsesc ${fmt(need - Math.max(i.stock_depot, 0))} ${i.unit} (locație ${fmt(i.stock_location)}, depozit ${fmt(i.stock_depot)}).` });
  }

  const total = items.reduce((s, i) => s + i.qty, 0);
  if (capacity && total > capacity) w.push({ tone: "bad", text: `Planul are ${fmt(total)} bucăți, peste capacitatea dospitorului (${capacity}).` });

  const proofs = items.filter((i) => i.proof != null).map((i) => i.proof!);
  if (proofs.length > 1 && Math.max(...proofs) - Math.min(...proofs) > 15) {
    w.push({ tone: "info", text: "Produsele au durate de dospire diferite: introduceți-le în dospitor la orele lor, nu toate odată." });
  }

  const now = nowOffset(date);
  const late = schedule(date, readyTime, items).filter((t) => !t.doneAt && t.offset < now);
  if (late.length) w.push({ tone: "bad", text: `${late.length} sarcini au ora depășită și nu sunt bifate.` });
  if (status === "draft" && items.length) w.push({ tone: "warn", text: "Planul este ciornă: personalul vede sarcinile doar după confirmare." });
  return w;
}

const fmt = (n: number) => new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(n);

/** Produsele care pot intra în plan: cele congelate sau cu durate de dospire configurate. */
export async function proofableProducts() {
  return q<{ id: number; name: string; unit: string; configured: boolean }>(
    `SELECT p.id, p.name, p.unit, (c.product_id IS NOT NULL) configured
       FROM products p LEFT JOIN product_proofing c ON c.product_id = p.id
      WHERE p.active AND (p.is_frozen OR c.product_id IS NOT NULL) ORDER BY configured DESC, p.name`,
  );
}

/**
 * Propunere de cantități: media vânzărilor din aceeași zi a săptămânii, pe ultimele 4 astfel de zile
 * cu vânzări în locație (din Publine), rotunjită în sus.
 */
export async function suggestQuantities(locationId: number, date: string, productIds: number[]) {
  if (!productIds.length) return [];
  return q<{ product_id: number; qty: number; days: number }>(
    `WITH days AS (
        SELECT DISTINCT sold_date FROM sales_lines
         WHERE location_id = $1 AND sold_date < $2::date AND extract(isodow FROM sold_date) = extract(isodow FROM $2::date)
         ORDER BY sold_date DESC LIMIT 4)
     SELECT s.product_id, ceil(sum(s.qty) / (SELECT count(*) FROM days))::float8 qty, (SELECT count(*)::int FROM days) days
       FROM sales_lines s
      WHERE s.location_id = $1 AND s.sold_date IN (SELECT sold_date FROM days) AND s.product_id = ANY($3::int[])
      GROUP BY s.product_id HAVING sum(s.qty) > 0`,
    [locationId, date, productIds],
  );
}

/** Starea planurilor pe următoarele zile, pentru fiecare locație permisă. */
export async function weekOverview(user: SessionUser, from: string, days: number) {
  const params: unknown[] = [from, days];
  let scope = "TRUE";
  if (user.locationIds !== null) { params.push(user.locationIds); scope = "p.location_id = ANY($3::int[])"; }
  return q<{ location_id: number; plan_date: string; status: string; items: number; qty: number }>(
    `SELECT p.location_id, p.plan_date::text plan_date, p.status, count(i.id)::int items, coalesce(sum(i.qty),0)::float8 qty
       FROM proofing_plans p LEFT JOIN proofing_items i ON i.plan_id = p.id
      WHERE p.status <> 'cancelled' AND p.plan_date >= $1::date AND p.plan_date < $1::date + $2::int AND ${scope}
      GROUP BY p.id`,
    params,
  );
}
