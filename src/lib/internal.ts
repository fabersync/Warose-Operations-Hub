import "server-only";
import { q, tx, type Query } from "./db";
import { audit } from "./audit";
import type { SessionUser } from "./auth";

/** Consumul intern (personal, protocol) și pierderile de sfârșit de zi. */
export type UseKind = "staff" | "protocol" | "loss";

export const USE_KINDS: Record<UseKind, { label: string; title: string; person: string; personHint: string; reason: string; reasonHint: string }> = {
  staff: { label: "Consum personal", title: "Consum personal", person: "Angajat", personHint: "numele angajatului", reason: "Observații", reasonHint: "opțional" },
  protocol: { label: "Protocol", title: "Protocol", person: "Beneficiar", personHint: "ex: client, partener, eveniment", reason: "Motiv", reasonHint: "ex: degustare, cadou partener" },
  loss: { label: "Pierderi", title: "Pierderi de sfârșit de zi", person: "Responsabil", personHint: "opțional", reason: "Motiv", reasonHint: "ex: nevândut, expirat, deteriorat" },
};

/**
 * Costul unitar: costul de producție din rețeta activă (când toate ingredientele au preț),
 * altfel ultimul preț de achiziție. Prețul de vânzare este fără TVA.
 */
export async function unitCosts(productIds: number[], query: Query = q) {
  if (!productIds.length) return new Map<number, { cost: number | null; source: "recipe" | "purchase" | null; price: number | null }>();
  const rows = await query<{ id: number; recipe_cost: number | null; cost_price: number | null; price: number | null }>(
    `SELECT p.id,
            (SELECT CASE WHEN bool_and(ip.cost_price IS NOT NULL) THEN sum(i.qty * ip.cost_price) / r.yield_qty END
               FROM recipes r JOIN recipe_items i ON i.recipe_id = r.id JOIN products ip ON ip.id = i.ingredient_id
              WHERE r.product_id = p.id AND r.active GROUP BY r.yield_qty)::float8 recipe_cost,
            p.cost_price::float8 cost_price,
            (p.sale_price / (1 + coalesce(p.vat_rate, 0) / 100))::float8 price
       FROM products p WHERE p.id = ANY($1::int[])`,
    [productIds],
  );
  return new Map(rows.map((r) => [r.id, {
    cost: r.recipe_cost ?? r.cost_price,
    source: r.recipe_cost != null ? "recipe" as const : r.cost_price != null ? "purchase" as const : null,
    price: r.price,
  }]));
}

/**
 * Înregistrează consumul / pierderile și efectul în stoc: produsul însuși dacă are stoc gestionat,
 * altfel ingredientele rețetei (pentru produsele preparate în magazin).
 */
export async function recordUses(user: SessionUser, input: { locationId: number; kind: UseKind; date: string; person: string | null; reason: string | null; lines: { productId: number; qty: number }[] }) {
  return tx(async (tq) => {
    const costs = await unitCosts(input.lines.map((l) => l.productId), tq);
    // Mișcările de stoc au ora sfârșitului zilei alese (sau ora curentă, pentru ziua de azi).
    const at = (await tq<{ at: string }>(
      `SELECT least(now(), ($1::date + time '21:00') AT TIME ZONE 'Europe/Bucharest')::text at`, [input.date]))[0].at;
    const moveKind = input.kind === "loss" ? "loss" : "consumption";
    const note = `${USE_KINDS[input.kind].label}${input.person ? ` · ${input.person}` : ""}${input.reason ? ` · ${input.reason}` : ""}`;
    let value = 0;
    for (const l of input.lines) {
      const c = costs.get(l.productId);
      const id = (await tq<{ id: number }>(
        `INSERT INTO internal_uses (location_id, kind, use_date, person, reason, product_id, qty, unit_cost, cost_source, unit_price, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [input.locationId, input.kind, input.date, input.person, input.reason, l.productId, l.qty, c?.cost ?? null, c?.source ?? null, c?.price ?? null, user.id],
      ))[0].id;
      value += (c?.cost ?? 0) * l.qty;
      await tq(
        `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, note, created_by, internal_use_id)
         SELECT $1, p.id, -$3::numeric, $4, $5::timestamptz, $6, $7, $8 FROM products p WHERE p.id = $2 AND p.track_stock`,
        [input.locationId, l.productId, l.qty, moveKind, at, note, user.id, id],
      );
      await tq(
        `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, note, created_by, internal_use_id)
         SELECT $1, i.ingredient_id, -round($3::numeric * i.qty / r.yield_qty, 3), $4, $5::timestamptz, $6 || ' (rețetă ' || p.name || ')', $7, $8
           FROM products p JOIN recipes r ON r.product_id = p.id AND r.active
           JOIN recipe_items i ON i.recipe_id = r.id JOIN products ip ON ip.id = i.ingredient_id AND ip.track_stock
          WHERE p.id = $2 AND NOT p.track_stock AND p.consume_recipe_on_sale AND round($3::numeric * i.qty / r.yield_qty, 3) <> 0`,
        [input.locationId, l.productId, l.qty, moveKind, at, note, user.id, id],
      );
    }
    await audit({ userId: user.id, action: `internal_use.${input.kind}`, entity: "location", entityId: input.locationId,
      details: { date: input.date, person: input.person, reason: input.reason, lines: input.lines.length, value: Math.round(value * 100) / 100 } }, tq);
    return { lines: input.lines.length, value };
  });
}

/** Anularea: rândul rămâne în istoric ca anulat, iar mișcările de stoc se stornează. */
export async function cancelUse(user: SessionUser, id: number) {
  await tx(async (tq) => {
    const u = (await tq<{ location_id: number; cancelled_at: string | null }>("SELECT location_id, cancelled_at FROM internal_uses WHERE id=$1 FOR UPDATE", [id]))[0];
    if (!u || u.cancelled_at) return;
    if (user.locationIds !== null && !user.locationIds.includes(u.location_id)) throw new Error("Nu aveți acces la această locație.");
    await tq("UPDATE internal_uses SET cancelled_at=now(), cancelled_by=$2 WHERE id=$1", [id, user.id]);
    await tq(
      `INSERT INTO stock_movements (location_id, product_id, qty, kind, occurred_at, reverses_id, note, created_by)
       SELECT m.location_id, m.product_id, -m.qty, 'reversal', m.occurred_at, m.id, 'Anulare: ' || coalesce(m.note, ''), $2
         FROM stock_movements m WHERE m.internal_use_id = $1 AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)`,
      [id, user.id],
    );
    await audit({ userId: user.id, action: "internal_use.cancel", entity: "internal_use", entityId: id }, tq);
  });
}

export interface UseRow {
  id: number; use_date: string; location_id: number; location: string; kind: UseKind; person: string | null; reason: string | null;
  product: string; unit: string; qty: number; unit_cost: number | null; cost_source: string | null; cost: number | null; unit_price: number | null; sale_value: number | null;
  author: string; created_at: string; cancelled: boolean;
}

export async function listUses(user: SessionUser, f: { from: string; to: string; locationId?: number | null; kinds?: UseKind[]; includeCancelled?: boolean }) {
  const params: unknown[] = [f.from, f.to];
  const where = ["u.use_date BETWEEN $1::date AND $2::date"];
  if (user.locationIds !== null) { params.push(user.locationIds); where.push(`u.location_id = ANY($${params.length}::int[])`); }
  if (f.locationId) { params.push(f.locationId); where.push(`u.location_id = $${params.length}`); }
  if (f.kinds?.length) { params.push(f.kinds); where.push(`u.kind = ANY($${params.length}::text[])`); }
  if (!f.includeCancelled) where.push("u.cancelled_at IS NULL");
  return q<UseRow>(
    `SELECT u.id, u.use_date::text use_date, u.location_id, l.name location, u.kind, u.person, u.reason, p.name product, p.unit,
            u.qty::float8 qty, u.unit_cost::float8 unit_cost, u.cost_source, round(u.qty * u.unit_cost, 2)::float8 cost,
            u.unit_price::float8 unit_price, round(u.qty * u.unit_price, 2)::float8 sale_value,
            usr.name author, u.created_at, u.cancelled_at IS NOT NULL cancelled
       FROM internal_uses u JOIN locations l ON l.id = u.location_id JOIN products p ON p.id = u.product_id JOIN users usr ON usr.id = u.created_by
      WHERE ${where.join(" AND ")}
      ORDER BY u.use_date DESC, u.id DESC LIMIT 20000`,
    params,
  );
}

/** Produsele propuse în formular: cele vândute recent în locație, apoi produsele finite. */
export async function useProducts(locationId: number) {
  return q<{ id: number; name: string; unit: string; sold: number }>(
    `SELECT p.id, p.name, p.unit, coalesce(s.qty, 0)::float8 sold
       FROM products p
       LEFT JOIN (SELECT product_id, sum(qty) qty FROM sales_lines WHERE location_id = $1 AND sold_date > current_date - 60 GROUP BY 1) s ON s.product_id = p.id
      WHERE p.active AND p.category <> 'service' AND (s.qty IS NOT NULL OR p.category IN ('finished','merchandise'))
      ORDER BY coalesce(s.qty, 0) DESC, p.name
      LIMIT 600`,
    [locationId],
  );
}
