"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canEditProduction } from "@/lib/production";

export type FormState = { error?: string; ok?: string };

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(",", ".");
  return s === "" ? null : Number(s);
};

async function editor() {
  const user = await requireUser("production");
  if (!canEditProduction(user)) throw new Error("Doar administratorul și responsabilul BRUTĂRIE pot modifica producția.");
  return user;
}

/* ---------------------------- Rețete ---------------------------- */

/** Salvează rețeta ca versiune nouă; versiunea anterioară rămâne în istoric, legată de documentele vechi. */
export async function saveRecipe(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const productId = Number(form.get("product_id"));
  const yieldQty = num(form.get("yield_qty"));
  const note = String(form.get("note") ?? "").trim() || null;
  const ids = form.getAll("ingredient_id").map(Number);
  const qtys = form.getAll("qty").map((v) => num(v));
  if (!productId) return { error: "Produs lipsă." };
  if (!yieldQty || yieldQty <= 0) return { error: "Indicați câte bucăți rezultă din rețetă (randament)." };
  const items = ids.map((id, i) => ({ id, qty: qtys[i] })).filter((x) => x.id);
  if (!items.length) return { error: "Adăugați cel puțin o materie primă." };
  if (items.some((x) => !x.qty || x.qty <= 0)) return { error: "Toate cantitățile trebuie să fie pozitive." };
  if (new Set(items.map((x) => x.id)).size !== items.length) return { error: "O materie primă apare de două ori." };
  if (items.some((x) => x.id === productId)) return { error: "Produsul nu poate fi ingredient în propria rețetă." };

  await tx(async (tq) => {
    const v = (await tq<{ v: number }>("SELECT coalesce(max(version),0)+1 v FROM recipes WHERE product_id=$1", [productId]))[0].v;
    await tq("UPDATE recipes SET active=false WHERE product_id=$1 AND active", [productId]);
    const r = (await tq<{ id: number }>(
      "INSERT INTO recipes (product_id, version, yield_qty, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [productId, v, yieldQty, note, user.id],
    ))[0];
    for (const it of items) await tq("INSERT INTO recipe_items (recipe_id, ingredient_id, qty) VALUES ($1,$2,$3)", [r.id, it.id, it.qty]);
    await tq("UPDATE products SET category='finished' WHERE id=$1 AND category IN ('merchandise','other')", [productId]);
    await audit({ userId: user.id, action: "recipe.save", entity: "product", entityId: productId, details: { version: v, yieldQty, items } }, tq);
  });
  revalidatePath("/productie", "layout");
  return { ok: "Rețeta a fost salvată ca versiune nouă." };
}

/** Prețul de achiziție al unei materii prime (manual până la importul facturilor). */
export async function setCostPrice(form: FormData) {
  const user = await editor();
  const productId = Number(form.get("product_id"));
  const price = num(form.get("cost_price"));
  if (!productId || price === null || price < 0) return;
  await q("UPDATE products SET cost_price=$2, cost_updated_at=now() WHERE id=$1", [productId, price]);
  await audit({ userId: user.id, action: "product.cost_price", entity: "product", entityId: productId, details: { price } });
  revalidatePath("/productie", "layout");
}

/* ------------------------ Plan de producție ------------------------ */

export async function createOrder(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const locationId = Number(form.get("location_id"));
  const freezerId = Number(form.get("freezer_location_id")) || null;
  const date = String(form.get("planned_for") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  const ids = form.getAll("product_id").map(Number);
  const qtys = form.getAll("planned_qty").map((v) => num(v));
  const lines = ids.map((id, i) => ({ id, qty: qtys[i] })).filter((x) => x.id && x.qty);
  if (!locationId || !canSeeLocation(user, locationId)) return { error: "Alegeți locația de producție." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Alegeți data producției." };
  if (!lines.length) return { error: "Adăugați cel puțin un produs cu cantitate." };
  if (lines.some((x) => x.qty! <= 0)) return { error: "Cantitățile trebuie să fie pozitive." };
  if (new Set(lines.map((x) => x.id)).size !== lines.length) return { error: "Un produs apare de două ori în plan." };

  const id = await tx(async (tq) => {
    const o = (await tq<{ id: number }>(
      "INSERT INTO production_orders (location_id, freezer_location_id, planned_for, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [locationId, freezerId, date, note, user.id],
    ))[0];
    for (const l of lines) {
      await tq(
        `INSERT INTO production_lines (order_id, product_id, planned_qty, recipe_id)
         VALUES ($1,$2,$3,(SELECT id FROM recipes WHERE product_id=$2 AND active))`,
        [o.id, l.id, l.qty],
      );
    }
    await audit({ userId: user.id, action: "production.plan", entity: "production_order", entityId: o.id, details: { date, lines } }, tq);
    return o.id;
  });
  revalidatePath("/productie", "layout");
  redirect(`/productie/${id}`);
}

/**
 * Înregistrează cantitățile reale. Consumul teoretic se calculează din rețeta activă la acest moment
 * (rețeta este fixată pe linie), iar consumul efectiv introdus anterior se păstrează.
 */
export async function recordProduction(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const orderId = Number(form.get("order_id"));
  const o = await one<{ status: string; location_id: number }>("SELECT status, location_id FROM production_orders WHERE id=$1", [orderId]);
  if (!o || !canSeeLocation(user, o.location_id)) return { error: "Document inexistent." };
  if (!["planned", "recorded"].includes(o.status)) return { error: "Documentul aprobat nu mai poate fi modificat." };
  const lineIds = form.getAll("line_id").map(Number);
  const produced = form.getAll("produced_qty").map((v) => num(v));
  const freezer = form.getAll("to_freezer_qty").map((v) => num(v) ?? 0);
  const scrap = form.getAll("scrap_qty").map((v) => num(v) ?? 0);
  const expires = form.getAll("expires_on").map((v) => String(v || "") || null);

  for (let i = 0; i < lineIds.length; i++) {
    const p = produced[i];
    if (p === null || !Number.isFinite(p) || p < 0) return { error: "Completați cantitatea produsă pentru fiecare produs (0 dacă nu s-a produs)." };
    if (freezer[i]! < 0 || scrap[i]! < 0) return { error: "Cantitățile nu pot fi negative." };
    if (freezer[i]! + scrap[i]! > p + 1e-9) return { error: "Congelat + rebut nu poate depăși cantitatea produsă." };
  }

  await tx(async (tq) => {
    for (let i = 0; i < lineIds.length; i++) {
      await tq(
        `UPDATE production_lines SET produced_qty=$3, to_freezer_qty=$4, scrap_qty=$5, expires_on=$6,
                recipe_id=(SELECT id FROM recipes WHERE product_id=production_lines.product_id AND active)
          WHERE id=$1 AND order_id=$2`,
        [lineIds[i], orderId, produced[i], freezer[i], scrap[i], expires[i]],
      );
    }
    // Consumul teoretic = cantitate rețetă × produs / randament, pe ingredient.
    const theo = await tq<{ ingredient_id: number; qty: number; cost: number | null }>(
      `SELECT i.ingredient_id, sum(i.qty * pl.produced_qty / r.yield_qty)::float8 qty, max(p.cost_price)::float8 cost
         FROM production_lines pl JOIN recipes r ON r.id = pl.recipe_id JOIN recipe_items i ON i.recipe_id = r.id
         JOIN products p ON p.id = i.ingredient_id
        WHERE pl.order_id = $1 AND pl.produced_qty > 0
        GROUP BY i.ingredient_id`,
      [orderId],
    );
    await tq("DELETE FROM production_consumption WHERE order_id=$1 AND NOT (ingredient_id = ANY($2::int[]))", [orderId, theo.map((t) => t.ingredient_id)]);
    for (const t of theo) {
      await tq(
        `INSERT INTO production_consumption (order_id, ingredient_id, theoretical_qty, unit_cost) VALUES ($1,$2,$3,$4)
         ON CONFLICT (order_id, ingredient_id) DO UPDATE SET theoretical_qty = EXCLUDED.theoretical_qty, unit_cost = EXCLUDED.unit_cost`,
        [orderId, t.ingredient_id, Math.round(t.qty * 10000) / 10000, t.cost],
      );
    }
    await tq("UPDATE production_orders SET status='recorded', recorded_by=$2, recorded_at=now() WHERE id=$1", [orderId, user.id]);
    await audit({ userId: user.id, action: "production.record", entity: "production_order", entityId: orderId,
      details: { lines: lineIds.map((id, i) => ({ id, produced: produced[i], freezer: freezer[i], scrap: scrap[i] })) } }, tq);
  });
  revalidatePath("/productie", "layout");
  return { ok: "Producția a fost înregistrată. Verificați consumul și aprobați documentul." };
}

/** Consumul efectiv (opțional), atunci când se cântărește. Gol = se folosește consumul teoretic. */
export async function saveActualConsumption(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const orderId = Number(form.get("order_id"));
  const o = await one<{ status: string }>("SELECT status FROM production_orders WHERE id=$1", [orderId]);
  if (o?.status !== "recorded") return { error: "Consumul se poate modifica doar înainte de aprobare." };
  const ids = form.getAll("ingredient_id").map(Number);
  const vals = form.getAll("actual_qty").map((v) => num(v));
  if (vals.some((v) => v !== null && (!Number.isFinite(v) || v < 0))) return { error: "Cantitățile trebuie să fie pozitive." };
  await tx(async (tq) => {
    for (let i = 0; i < ids.length; i++) {
      await tq("UPDATE production_consumption SET actual_qty=$3 WHERE order_id=$1 AND ingredient_id=$2", [orderId, ids[i], vals[i]]);
    }
    await audit({ userId: user.id, action: "production.actual_consumption", entity: "production_order", entityId: orderId,
      details: ids.map((id, i) => ({ id, actual: vals[i] })) }, tq);
  });
  revalidatePath(`/productie/${orderId}`);
  return { ok: "Consumul efectiv a fost salvat." };
}

/**
 * Aprobarea trece documentul în stocul operațional:
 * + produs finit în BRUTĂRIE, − rebut, transfer BRUTĂRIE → congelator pentru cantitatea congelată (cu lot),
 * − consumul de materii prime (doar pentru ingredientele cu stoc gestionat).
 */
export async function approveOrder(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const orderId = Number(form.get("order_id"));
  try {
    await tx(async (tq) => {
      const o = (await tq<{ status: string; location_id: number; freezer_location_id: number | null; planned_for: string }>(
        "SELECT status, location_id, freezer_location_id, planned_for::text planned_for FROM production_orders WHERE id=$1 FOR UPDATE", [orderId]))[0];
      if (!o || !canSeeLocation(user, o.location_id)) throw new Error("Document inexistent.");
      if (o.status !== "recorded") throw new Error("Doar documentele înregistrate pot fi aprobate.");
      const lines = await tq<{ product_id: number; produced: number; freezer: number; scrap: number; expires_on: string | null; has_recipe: boolean }>(
        `SELECT product_id, coalesce(produced_qty,0)::float8 produced, coalesce(to_freezer_qty,0)::float8 freezer,
                coalesce(scrap_qty,0)::float8 scrap, expires_on::text expires_on, recipe_id IS NOT NULL has_recipe
           FROM production_lines WHERE order_id=$1`, [orderId]);
      if (lines.some((l) => l.freezer > 0) && !o.freezer_location_id) throw new Error("Alegeți congelatorul de destinație pentru cantitățile congelate.");

      const lot = `P${orderId}-${o.planned_for.replaceAll("-", "").slice(2)}`;
      const mv = (loc: number, product: number, qty: number, kind: string, extra: { counterpart?: number; group?: string; lot?: string | null; expires?: string | null; note: string }) =>
        tq(
          `INSERT INTO stock_movements (location_id, product_id, qty, kind, counterpart_location_id, transfer_group, lot, produced_on, expires_on,
                                        document_ref, note, occurred_at, production_order_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13)`,
          [loc, product, qty, kind, extra.counterpart ?? null, extra.group ?? null, extra.lot ?? null,
           extra.lot ? o.planned_for : null, extra.expires ?? null, `Producție #${orderId}`, extra.note, orderId, user.id],
        );

      for (const l of lines) {
        if (l.produced <= 0) continue;
        await mv(o.location_id, l.product_id, l.produced, "production", { lot, expires: l.expires_on, note: "Produs finit obținut" });
        if (l.scrap > 0) await mv(o.location_id, l.product_id, -l.scrap, "loss", { lot, note: "Rebut producție" });
        if (l.freezer > 0) {
          const group = crypto.randomUUID();
          await mv(o.location_id, l.product_id, -l.freezer, "transfer_out", { counterpart: o.freezer_location_id!, group, lot, note: "Trimis la congelare" });
          await mv(o.freezer_location_id!, l.product_id, l.freezer, "transfer_in", { counterpart: o.location_id, group, lot, expires: l.expires_on, note: "Intrare din producție" });
        }
      }
      const cons = await tq<{ ingredient_id: number; qty: number }>(
        `SELECT c.ingredient_id, coalesce(c.actual_qty, c.theoretical_qty)::float8 qty
           FROM production_consumption c JOIN products p ON p.id = c.ingredient_id
          WHERE c.order_id = $1 AND p.track_stock AND coalesce(c.actual_qty, c.theoretical_qty) > 0`, [orderId]);
      for (const c of cons) await mv(o.location_id, c.ingredient_id, -c.qty, "consumption", { note: "Consum materii prime" });

      await tq("UPDATE production_orders SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [orderId, user.id]);
      await audit({ userId: user.id, action: "production.approve", entity: "production_order", entityId: orderId,
        details: { lot, lines: lines.length, consumptionPosted: cons.length } }, tq);
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Document aprobat. Stocurile au fost actualizate." };
}

/** Marchează documentul ca introdus în SAGA C (numărul documentului din SAGA), pentru reconciliere. */
export async function markSaga(form: FormData) {
  const user = await editor();
  const orderId = Number(form.get("order_id"));
  const docNo = String(form.get("saga_doc_no") ?? "").trim();
  if (!docNo) return;
  await q("UPDATE production_orders SET saga_doc_no=$2, saga_registered_at=now(), saga_registered_by=$3 WHERE id=$1 AND status='approved'", [orderId, docNo, user.id]);
  await audit({ userId: user.id, action: "production.saga_registered", entity: "production_order", entityId: orderId, details: { docNo } });
  revalidatePath("/productie", "layout");
}

export async function cancelOrder(form: FormData) {
  const user = await editor();
  const orderId = Number(form.get("order_id"));
  await q("UPDATE production_orders SET status='cancelled' WHERE id=$1 AND status IN ('planned','recorded')", [orderId]);
  await audit({ userId: user.id, action: "production.cancel", entity: "production_order", entityId: orderId });
  revalidatePath("/productie", "layout");
  redirect("/productie");
}

/* ------------------------ SAGA C ------------------------ */

export async function uploadSagaProduction(_: FormState, form: FormData): Promise<FormState> {
  let user;
  try { user = await editor(); } catch (e) { return { error: (e as Error).message }; }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Alegeți raportul exportat din SAGA." };
  try {
    const { ingestSagaProduction } = await import("@/lib/saga");
    const r = await ingestSagaProduction(Buffer.from(await file.arrayBuffer()), file.name, user.id);
    revalidatePath("/productie", "layout");
    return r.status === "duplicate" ? { error: r.message } : { ok: r.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Asociază un cod SAGA cu un produs existent sau creează produsul finit din denumirea SAGA. */
export async function mapSagaCode(form: FormData) {
  const user = await editor();
  const codeId = Number(form.get("code_id"));
  let productId = Number(form.get("product_id")) || null;
  const c = await one<{ code: string; name_in_source: string }>("SELECT code, name_in_source FROM product_codes WHERE id=$1 AND source='saga'", [codeId]);
  if (!c) return;
  if (form.get("create") === "1") {
    const unit = (await one<{ unit: string | null }>("SELECT unit FROM saga_production_lines WHERE code=$1 AND unit IS NOT NULL LIMIT 1", [c.code]))?.unit ?? "buc";
    productId = (await one<{ id: number }>("INSERT INTO products (name, unit, category) VALUES ($1,$2,'finished') RETURNING id", [c.name_in_source.toUpperCase(), unit]))!.id;
  }
  if (!productId) return;
  await q("UPDATE product_codes SET product_id=$2 WHERE id=$1", [codeId, productId]);
  await audit({ userId: user.id, action: "product_code.map_saga", entity: "product_code", entityId: codeId, details: { code: c.code, productId } });
  revalidatePath("/productie", "layout");
}
