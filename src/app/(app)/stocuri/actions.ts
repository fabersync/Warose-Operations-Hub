"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { audit } from "@/lib/audit";

export type MovementState = { ok?: string; error?: string };

/** Semnul cantității este dat de tipul operațiunii; utilizatorul introduce mereu o cantitate pozitivă. */
const SIGN: Record<string, 1 | -1 | 0> = {
  receipt: 1, production: 1, transfer: -1, loss: -1, consumption: -1, adjustment_in: 1, adjustment_out: -1,
};
const NEEDS_NOTE = new Set(["loss", "adjustment_in", "adjustment_out"]);

export async function recordMovement(_: MovementState, form: FormData): Promise<MovementState> {
  const user = await requireUser("stock");
  const kind = String(form.get("kind") ?? "");
  const locationId = Number(form.get("location_id"));
  const productId = Number(form.get("product_id"));
  const qty = Number(String(form.get("qty") ?? "").replace(",", "."));
  const toLocationId = Number(form.get("to_location_id")) || null;
  const lot = String(form.get("lot") ?? "").trim() || null;
  const producedOn = String(form.get("produced_on") ?? "") || null;
  const expiresOn = String(form.get("expires_on") ?? "") || null;
  const documentRef = String(form.get("document_ref") ?? "").trim() || null;
  const note = String(form.get("note") ?? "").trim() || null;

  if (!(kind in SIGN)) return { error: "Alegeți tipul operațiunii." };
  if (!locationId || !productId) return { error: "Alegeți locația și produsul." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Cantitatea trebuie să fie un număr pozitiv." };
  if (!canSeeLocation(user, locationId)) return { error: "Nu aveți acces la această locație." };
  if (kind === "transfer" && (!toLocationId || toLocationId === locationId)) return { error: "Alegeți locația destinatară (diferită de sursă)." };
  if (NEEDS_NOTE.has(kind) && !note) return { error: "Pentru pierderi și ajustări este obligatorie o explicație." };

  const sign = SIGN[kind];
  try {
    await tx(async (q) => {
      // Blocăm ieșirile care ar duce stocul operațional sub zero.
      if (sign < 0) {
        const cur = (await q<{ s: number }>(
          "SELECT coalesce(sum(qty),0)::float8 s FROM stock_movements WHERE location_id=$1 AND product_id=$2" + (lot ? " AND lot=$3" : ""),
          lot ? [locationId, productId, lot] : [locationId, productId],
        ))[0].s;
        if (cur - qty < -1e-9) throw new Error(`Stoc insuficient: disponibil ${cur}${lot ? ` în lotul ${lot}` : ""}, se cer ${qty}.`);
      }
      const base = [productId, lot, producedOn, expiresOn, documentRef, note, user.id];
      const insert = (loc: number, q2: number, k: string, counterpart: number | null, group: string | null) =>
        q<{ id: number }>(
          `INSERT INTO stock_movements (location_id, qty, kind, counterpart_location_id, transfer_group, product_id, lot, produced_on, expires_on, document_ref, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [loc, q2, k, counterpart, group, ...base],
        );
      if (kind === "transfer") {
        const group = crypto.randomUUID();
        await insert(locationId, -qty, "transfer_out", toLocationId, group);
        await insert(toLocationId!, qty, "transfer_in", locationId, group);
      } else {
        const k = kind.startsWith("adjustment") ? "adjustment" : kind;
        await insert(locationId, sign * qty, k, null, null);
      }
      await audit({ userId: user.id, action: `stock.${kind}`, entity: "product", entityId: productId,
        details: { locationId, toLocationId, qty, lot, documentRef, note } }, q);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Operațiunea a fost înregistrată." };
}

/** Stornarea creează o mișcare opusă; mișcarea originală rămâne în istoric. */
export async function reverseMovement(form: FormData) {
  const user = await requireUser("stock");
  const id = Number(form.get("movement_id"));
  const m = await one<{ id: number; location_id: number; product_id: number; qty: string; lot: string | null; transfer_group: string | null }>(
    "SELECT id, location_id, product_id, qty, lot, transfer_group FROM stock_movements WHERE id=$1 AND kind NOT IN ('reversal', 'sale', 'inventory')", [id]);
  if (!m || !canSeeLocation(user, m.location_id)) return;
  await tx(async (q) => {
    const targets = m.transfer_group
      ? await q<{ id: number; location_id: number; product_id: number; qty: string; lot: string | null }>("SELECT id, location_id, product_id, qty, lot FROM stock_movements WHERE transfer_group=$1", [m.transfer_group])
      : [m];
    for (const t of targets) {
      const exists = await q("SELECT 1 FROM stock_movements WHERE reverses_id=$1", [t.id]);
      if (exists.length) continue;
      await q(
        `INSERT INTO stock_movements (location_id, product_id, qty, kind, lot, reverses_id, note, created_by)
         VALUES ($1,$2,$3,'reversal',$4,$5,$6,$7)`,
        [t.location_id, t.product_id, -Number(t.qty), t.lot, t.id, `Stornare mișcare #${t.id}`, user.id],
      );
    }
    await audit({ userId: user.id, action: "stock.reverse", entity: "stock_movement", entityId: id }, q);
  });
  revalidatePath("/", "layout");
}
