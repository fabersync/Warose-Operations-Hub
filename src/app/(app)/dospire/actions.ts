"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canConfigureProofing, canPlanProofing, proofableProducts, suggestQuantities, type TaskKind } from "@/lib/proofing";

export type FormState = { error?: string; ok?: string };
const int = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s === "" ? null : Number(s); };
const numv = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };

/* --------------------------- Setări --------------------------- */

export async function saveProductProofing(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("proofing");
  if (!canConfigureProofing(user)) return { error: "Doar administratorul și responsabilul BRUTĂRIE pot modifica duratele." };
  const productId = Number(form.get("product_id"));
  const thaw = int(form.get("thaw_minutes")) ?? 0;
  const proof = int(form.get("proof_minutes"));
  const bake = int(form.get("bake_minutes")) ?? 0;
  const validated = form.get("validated") === "on";
  const note = String(form.get("note") ?? "").trim() || null;
  if (!productId) return { error: "Alegeți produsul." };
  if (proof == null || !Number.isInteger(proof) || proof <= 0) return { error: "Durata de dospire trebuie să fie un număr întreg de minute, mai mare ca 0." };
  if (![thaw, bake].every((x) => Number.isInteger(x) && x >= 0)) return { error: "Duratele trebuie să fie minute întregi, pozitive." };
  if (thaw + proof + bake > 24 * 60) return { error: "Durata totală depășește 24 de ore." };
  await q(
    `INSERT INTO product_proofing (product_id, thaw_minutes, proof_minutes, bake_minutes, validated, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (product_id) DO UPDATE SET thaw_minutes=$2, proof_minutes=$3, bake_minutes=$4, validated=$5, note=$6, updated_by=$7, updated_at=now()`,
    [productId, thaw, proof, bake, validated, note, user.id],
  );
  await q("UPDATE products SET is_frozen = true WHERE id = $1", [productId]);
  await audit({ userId: user.id, action: "proofing.product_config", entity: "product", entityId: productId, details: { thaw, proof, bake, validated } });
  revalidatePath("/dospire", "layout");
  return { ok: "Duratele au fost salvate." };
}

export async function saveLocationSettings(form: FormData) {
  const user = await requireUser("proofing");
  if (!canConfigureProofing(user) && user.role !== "location_manager") return;
  const locationId = Number(form.get("location_id"));
  const ready = String(form.get("ready_time") ?? "");
  const capacity = int(form.get("capacity"));
  if (!canSeeLocation(user, locationId) || !/^\d{2}:\d{2}$/.test(ready)) return;
  await q(
    `INSERT INTO proofing_settings (location_id, ready_time, capacity, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (location_id) DO UPDATE SET ready_time=$2, capacity=$3, updated_by=$4, updated_at=now()`,
    [locationId, ready, capacity && capacity > 0 ? capacity : null, user.id],
  );
  await audit({ userId: user.id, action: "proofing.location_settings", entity: "location", entityId: locationId, details: { ready, capacity } });
  revalidatePath("/dospire", "layout");
}

/* ---------------------------- Planuri ---------------------------- */

async function planner(locationId: number) {
  const user = await requireUser("proofing");
  if (!canPlanProofing(user)) throw new Error("Nu aveți dreptul să modificați planul.");
  if (!canSeeLocation(user, locationId)) throw new Error("Nu aveți acces la această locație.");
  return user;
}

async function draftPlan(planId: number) {
  const p = await one<{ location_id: number; status: string; plan_date: string }>("SELECT location_id, status, plan_date::text plan_date FROM proofing_plans WHERE id=$1", [planId]);
  if (!p) throw new Error("Plan inexistent.");
  if (p.status !== "draft") throw new Error("Planul este confirmat. Readuceți-l la ciornă pentru modificări.");
  return p;
}

/** Creează planul zilei; opțional îl completează cu cantitățile propuse din vânzările Publine. */
export async function createPlan(form: FormData) {
  const locationId = Number(form.get("location_id"));
  const date = String(form.get("plan_date") ?? "");
  const user = await planner(locationId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  // Propunerile se calculează înaintea tranzacției: în tranzacție se folosește doar conexiunea ei (tq),
  // altfel o interogare pe conexiunea globală ar aștepta după tranzacție (blocaj cu baza embedded).
  const suggestions = form.get("propose") === "1"
    ? await suggestQuantities(locationId, date, (await proofableProducts()).filter((x) => x.configured).map((x) => x.id))
    : [];
  await tx(async (tq) => {
    const exists = await tq("SELECT 1 FROM proofing_plans WHERE location_id=$1 AND plan_date=$2 AND status <> 'cancelled'", [locationId, date]);
    if (exists.length) return;
    const p = (await tq<{ id: number }>(
      `INSERT INTO proofing_plans (location_id, plan_date, ready_time, created_by)
       VALUES ($1, $2, coalesce((SELECT ready_time FROM proofing_settings WHERE location_id=$1), '05:00'), $3) RETURNING id`,
      [locationId, date, user.id],
    ))[0];
    for (const s of suggestions) {
      await tq("INSERT INTO proofing_items (plan_id, product_id, qty, suggested_qty) VALUES ($1,$2,$3,$3)", [p.id, s.product_id, s.qty]);
    }
    await audit({ userId: user.id, action: "proofing.plan_create", entity: "proofing_plan", entityId: p.id, details: { locationId, date, suggested: suggestions.length } }, tq);
  });
  revalidatePath("/dospire", "layout");
}

/** Adaugă sau modifică un produs din plan; cantitatea 0 îl elimină. */
export async function setItem(_: FormState, form: FormData): Promise<FormState> {
  try {
    const planId = Number(form.get("plan_id"));
    const p = await draftPlan(planId);
    const user = await planner(p.location_id);
    const productId = Number(form.get("product_id"));
    const qty = numv(form.get("qty"));
    if (!productId) return { error: "Alegeți produsul." };
    if (qty == null || !Number.isFinite(qty) || qty < 0) return { error: "Cantitatea trebuie să fie un număr pozitiv (0 = elimină)." };
    if (qty === 0) await q("DELETE FROM proofing_items WHERE plan_id=$1 AND product_id=$2", [planId, productId]);
    else await q(
      `INSERT INTO proofing_items (plan_id, product_id, qty) VALUES ($1,$2,$3)
       ON CONFLICT (plan_id, product_id) DO UPDATE SET qty = EXCLUDED.qty`, [planId, productId, qty]);
    await audit({ userId: user.id, action: "proofing.item", entity: "proofing_plan", entityId: planId, details: { productId, qty } });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/dospire", "layout");
  return {};
}

export async function setReadyTime(form: FormData) {
  const planId = Number(form.get("plan_id"));
  const p = await draftPlan(planId);
  const user = await planner(p.location_id);
  const ready = String(form.get("ready_time") ?? "");
  if (!/^\d{2}:\d{2}$/.test(ready)) return;
  await q("UPDATE proofing_plans SET ready_time=$2 WHERE id=$1", [planId, ready]);
  await audit({ userId: user.id, action: "proofing.ready_time", entity: "proofing_plan", entityId: planId, details: { ready } });
  revalidatePath("/dospire", "layout");
}

/** Confirmarea fixează duratele pe fiecare linie; modificările ulterioare ale setărilor nu schimbă planul. */
export async function confirmPlan(_: FormState, form: FormData): Promise<FormState> {
  try {
    const planId = Number(form.get("plan_id"));
    const p = await draftPlan(planId);
    const user = await planner(p.location_id);
    await tx(async (tq) => {
      const items = await tq<{ n: number; missing: number }>(
        `SELECT count(*)::int n, count(*) FILTER (WHERE c.product_id IS NULL)::int missing
           FROM proofing_items i LEFT JOIN product_proofing c ON c.product_id = i.product_id WHERE i.plan_id = $1`, [planId]);
      if (!items[0].n) throw new Error("Planul nu are produse.");
      if (items[0].missing) throw new Error(`${items[0].missing} produse nu au durate configurate. Completați-le în Setări dospire.`);
      await tq(
        `UPDATE proofing_items i SET thaw_minutes = c.thaw_minutes, proof_minutes = c.proof_minutes, bake_minutes = c.bake_minutes
           FROM product_proofing c WHERE c.product_id = i.product_id AND i.plan_id = $1`, [planId]);
      await tq("UPDATE proofing_plans SET status='confirmed', confirmed_by=$2, confirmed_at=now() WHERE id=$1", [planId, user.id]);
      await audit({ userId: user.id, action: "proofing.confirm", entity: "proofing_plan", entityId: planId }, tq);
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Plan confirmat. Sarcinile sunt vizibile personalului." };
}

export async function reopenPlan(form: FormData) {
  const planId = Number(form.get("plan_id"));
  const p = await one<{ location_id: number; started: boolean }>(
    `SELECT location_id, EXISTS (SELECT 1 FROM proofing_items WHERE plan_id = $1 AND (thaw_done_at IS NOT NULL OR proof_done_at IS NOT NULL OR bake_done_at IS NOT NULL)) started
       FROM proofing_plans WHERE id = $1 AND status = 'confirmed'`, [planId]);
  if (!p || p.started) return;
  const user = await planner(p.location_id);
  await q("UPDATE proofing_plans SET status='draft', confirmed_by=NULL, confirmed_at=NULL WHERE id=$1", [planId]);
  await audit({ userId: user.id, action: "proofing.reopen", entity: "proofing_plan", entityId: planId });
  revalidatePath("/", "layout");
}

export async function cancelPlan(form: FormData) {
  const planId = Number(form.get("plan_id"));
  const p = await one<{ location_id: number }>("SELECT location_id FROM proofing_plans WHERE id=$1 AND status <> 'cancelled'", [planId]);
  if (!p) return;
  const user = await planner(p.location_id);
  await q("UPDATE proofing_plans SET status='cancelled' WHERE id=$1", [planId]);
  await audit({ userId: user.id, action: "proofing.cancel", entity: "proofing_plan", entityId: planId });
  revalidatePath("/", "layout");
}

/** Bifează / debifează o sarcină. Poate fi făcut și de personalul operațional al locației. */
export async function toggleTask(itemId: number, kind: TaskKind): Promise<FormState> {
  const user = await requireUser("proofing");
  if (!["thaw", "proof", "bake"].includes(kind)) return { error: "Sarcină invalidă." };
  const it = await one<{ location_id: number; status: string; done: boolean }>(
    `SELECT p.location_id, p.status, i.${kind}_done_at IS NOT NULL done
       FROM proofing_items i JOIN proofing_plans p ON p.id = i.plan_id WHERE i.id = $1`, [itemId]);
  if (!it || !canSeeLocation(user, it.location_id)) return { error: "Sarcină inexistentă." };
  if (it.status !== "confirmed") return { error: "Planul nu este confirmat." };
  await q(
    `UPDATE proofing_items SET ${kind}_done_at = CASE WHEN $2 THEN NULL ELSE now() END, ${kind}_done_by = CASE WHEN $2 THEN NULL ELSE $3::int END WHERE id = $1`,
    [itemId, it.done, user.id],
  );
  await audit({ userId: user.id, action: it.done ? "proofing.task_undo" : "proofing.task_done", entity: "proofing_item", entityId: itemId, details: { kind } });
  revalidatePath("/dospire");
  return {};
}
