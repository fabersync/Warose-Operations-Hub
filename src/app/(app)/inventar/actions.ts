"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canManageInventory } from "@/lib/inventory";

export type StartState = { error?: string };

/**
 * Deschide inventarul unei locații. Lista conține produsele cu stoc gestionat și pe cele care au avut
 * mișcări în locație. Stocul scriptic se recalculează la închidere, la momentul „as_of”, astfel încât
 * vânzările importate cu întârziere (ex: exportul de aseară) să fie luate în calcul corect.
 */
export async function startInventory(_: StartState, form: FormData): Promise<StartState> {
  const user = await requireUser("inventory");
  if (!canManageInventory(user)) return { error: "Doar administratorul, managerul de locație sau responsabilul BRUTĂRIE pot deschide un inventar." };
  const locationId = Number(form.get("location_id"));
  const asOf = String(form.get("as_of") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (!locationId || !canSeeLocation(user, locationId)) return { error: "Alegeți locația." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(asOf)) return { error: "Alegeți data și ora la care se referă inventarul." };

  let id: number;
  try {
    id = await tx(async (tq) => {
      const open = await tq("SELECT id FROM inventory_counts WHERE location_id=$1 AND status='open'", [locationId]);
      if (open.length) throw new Error(`Există deja un inventar deschis pentru această locație (#${open[0].id}).`);
      const c = (await tq<{ id: number; as_of: string }>(
        // Ora aleasă acoperă tot minutul (fără a depăși momentul curent), ca mișcările din acel minut să fie incluse.
        `INSERT INTO inventory_counts (location_id, as_of, started_by, note)
         VALUES ($1, LEAST(now(), ($2::timestamp AT TIME ZONE 'Europe/Bucharest') + interval '59.999 seconds'), $3, $4) RETURNING id, as_of`,
        [locationId, asOf, user.id, note],
      ))[0];
      await tq(
        `INSERT INTO inventory_count_lines (count_id, product_id, book_qty, unit_value)
         SELECT $1, p.id,
                coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id = $2 AND m.product_id = p.id AND m.occurred_at <= $3), 0),
                p.sale_price
           FROM products p
          WHERE p.active AND (p.track_stock OR EXISTS (SELECT 1 FROM stock_movements m WHERE m.location_id = $2 AND m.product_id = p.id))`,
        [c.id, locationId, c.as_of],
      );
      await audit({ userId: user.id, action: "inventory.start", entity: "inventory_count", entityId: c.id, details: { locationId, asOf } }, tq);
      return c.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/inventar/${id}`);
}

async function openCountForLine(lineId: number) {
  return one<{ count_id: number; location_id: number; status: string }>(
    `SELECT c.id count_id, c.location_id, c.status FROM inventory_count_lines l JOIN inventory_counts c ON c.id = l.count_id WHERE l.id = $1`,
    [lineId],
  );
}

/** Salvează cantitatea numărată pentru o linie. Gol = încă nenumărat. */
export async function saveCount(lineId: number, raw: string): Promise<{ ok: boolean; error?: string; value?: number | null }> {
  const user = await requireUser("inventory");
  const c = await openCountForLine(lineId);
  if (!c || !canSeeLocation(user, c.location_id)) return { ok: false, error: "Linie inexistentă." };
  if (c.status !== "open") return { ok: false, error: "Inventarul este închis." };
  const s = raw.trim().replace(",", ".");
  const value = s === "" ? null : Number(s);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: "Introduceți o cantitate pozitivă." };
  await q(
    "UPDATE inventory_count_lines SET counted_qty=$2, counted_by=$3, counted_at=CASE WHEN $2::numeric IS NULL THEN NULL ELSE now() END WHERE id=$1",
    [lineId, value, value === null ? null : user.id],
  );
  revalidatePath(`/inventar/${c.count_id}`);
  return { ok: true, value };
}

/** Adaugă în inventar un produs găsit fizic, dar care nu era pe listă. */
export async function addLine(form: FormData) {
  const user = await requireUser("inventory");
  const countId = Number(form.get("count_id"));
  const productId = Number(form.get("product_id"));
  const c = await one<{ location_id: number; status: string; as_of: string }>("SELECT location_id, status, as_of FROM inventory_counts WHERE id=$1", [countId]);
  if (!c || c.status !== "open" || !productId || !canSeeLocation(user, c.location_id)) return;
  await q(
    `INSERT INTO inventory_count_lines (count_id, product_id, book_qty, unit_value)
     SELECT $1, p.id, coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.location_id=$2 AND m.product_id=p.id AND m.occurred_at <= $4), 0), p.sale_price
       FROM products p WHERE p.id = $3
     ON CONFLICT (count_id, product_id) DO NOTHING`,
    [countId, c.location_id, productId, c.as_of],
  );
  await audit({ userId: user.id, action: "inventory.add_line", entity: "inventory_count", entityId: countId, details: { productId } });
  revalidatePath(`/inventar/${countId}`);
}

/**
 * Închide inventarul: recalculează stocul scriptic la momentul inventarului și înregistrează diferențele
 * ca mișcări „Diferență inventar”. Lipsurile se scad din loturi în ordinea vechimii (FIFO).
 */
export async function closeInventory(_: StartState, form: FormData): Promise<StartState> {
  const user = await requireUser("inventory");
  if (!canManageInventory(user)) return { error: "Nu aveți dreptul să închideți inventarul." };
  const countId = Number(form.get("count_id"));
  const zeroUncounted = form.get("zero_uncounted") === "on";
  try {
    await tx(async (tq) => {
      const c = (await tq<{ location_id: number; status: string; as_of: string }>(
        "SELECT location_id, status, as_of FROM inventory_counts WHERE id=$1 FOR UPDATE", [countId]))[0];
      if (!c || !canSeeLocation(user, c.location_id)) throw new Error("Inventar inexistent.");
      if (c.status !== "open") throw new Error("Inventarul nu mai este deschis.");

      await tq(
        `UPDATE inventory_count_lines l SET book_qty = coalesce((SELECT sum(m.qty) FROM stock_movements m
           WHERE m.location_id = $2 AND m.product_id = l.product_id AND m.occurred_at <= $3), 0)
         WHERE l.count_id = $1`,
        [countId, c.location_id, c.as_of],
      );
      if (zeroUncounted) {
        await tq("UPDATE inventory_count_lines SET counted_qty = 0, counted_by = $2, counted_at = now() WHERE count_id = $1 AND counted_qty IS NULL", [countId, user.id]);
      }

      const diffs = await tq<{ product_id: number; diff: number; unit_value: number | null }>(
        `SELECT product_id, (counted_qty - book_qty)::float8 diff, unit_value::float8 unit_value
           FROM inventory_count_lines WHERE count_id = $1 AND counted_qty IS NOT NULL AND counted_qty <> book_qty`,
        [countId],
      );
      const insert = (productId: number, qty: number, lot: string | null) =>
        tq(
          `INSERT INTO stock_movements (location_id, product_id, qty, kind, lot, occurred_at, inventory_count_id, note, created_by)
           VALUES ($1,$2,$3,'inventory',$4,$5,$6,$7,$8)`,
          [c.location_id, productId, qty, lot, c.as_of, countId, `Inventar #${countId}`, user.id],
        );
      let value = 0;
      for (const d of diffs) {
        value += d.diff * (d.unit_value ?? 0);
        if (d.diff > 0) { await insert(d.product_id, d.diff, null); continue; }
        let missing = -d.diff;
        const lots = await tq<{ lot: string | null; qty: number }>(
          `SELECT lot, sum(qty)::float8 qty FROM stock_movements
            WHERE location_id = $1 AND product_id = $2 AND occurred_at <= $3
            GROUP BY lot HAVING sum(qty) > 0
            ORDER BY min(produced_on) FILTER (WHERE qty > 0) NULLS LAST, lot NULLS LAST`,
          [c.location_id, d.product_id, c.as_of],
        );
        for (const l of lots) {
          if (missing <= 1e-9) break;
          const take = Math.min(missing, l.qty);
          await insert(d.product_id, -take, l.lot);
          missing -= take;
        }
        if (missing > 1e-9) await insert(d.product_id, -missing, null);
      }

      await tq(
        "UPDATE inventory_counts SET status='closed', closed_at=now(), closed_by=$2, posted_value=$3, uncounted_as_zero=$4 WHERE id=$1",
        [countId, user.id, Math.round(value * 100) / 100, zeroUncounted],
      );
      await audit({ userId: user.id, action: "inventory.close", entity: "inventory_count", entityId: countId,
        details: { differences: diffs.length, value: Math.round(value * 100) / 100, zeroUncounted } }, tq);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function cancelInventory(form: FormData) {
  const user = await requireUser("inventory");
  if (!canManageInventory(user)) return;
  const countId = Number(form.get("count_id"));
  const c = await one<{ location_id: number }>("SELECT location_id FROM inventory_counts WHERE id=$1 AND status='open'", [countId]);
  if (!c || !canSeeLocation(user, c.location_id)) return;
  await q("UPDATE inventory_counts SET status='cancelled', closed_at=now(), closed_by=$2 WHERE id=$1", [countId, user.id]);
  await audit({ userId: user.id, action: "inventory.cancel", entity: "inventory_count", entityId: countId });
  revalidatePath("/", "layout");
  redirect("/inventar");
}
