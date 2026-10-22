"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, canSeeLocation, type SessionUser } from "@/lib/auth";
import { one, tx, type Query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canFulfil, canOrder, canReceive, STATUS, type OrderStatus } from "@/lib/orders";

export type FormState = { error?: string; ok?: string };
const numv = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };
const fmt = (n: number) => new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 3 }).format(n);

async function event(tq: Query, orderId: number, userId: number, kind: "status" | "change" | "comment", status: string | null, message: string | null, details?: unknown) {
  await tq("INSERT INTO location_order_events (order_id, user_id, kind, status, message, details) VALUES ($1,$2,$3,$4,$5,$6::text::jsonb)",
    [orderId, userId, kind, status, message, details == null ? null : JSON.stringify(details)]);
}

type Locked = { id: number; status: OrderStatus; from_location_id: number; to_location_id: number; transfer_group: string | null; needed_for: string };

/** Blochează comanda pentru tranziție și verifică starea de plecare și dreptul utilizatorului. */
async function lockOrder(tq: Query, id: number, allowed: OrderStatus[], check: (o: Locked) => boolean) {
  const o = (await tq<Locked>(
    "SELECT id, status, from_location_id, to_location_id, transfer_group, needed_for::text needed_for FROM location_orders WHERE id=$1 FOR UPDATE", [id]))[0];
  if (!o) throw new Error("Comanda nu există.");
  if (!check(o)) throw new Error("Nu aveți dreptul pentru această operațiune.");
  if (!allowed.includes(o.status)) throw new Error(`Operațiunea nu este posibilă pentru o comandă „${STATUS[o.status].label}”.`);
  return o;
}

function readLines(form: FormData, idField: string, qtyField: string) {
  const ids = form.getAll(idField).map(Number);
  const qtys = form.getAll(qtyField).map((v) => numv(v));
  return ids.map((id, i) => ({ id, qty: qtys[i] }));
}

async function run(fn: (user: SessionUser) => Promise<string | void>): Promise<FormState> {
  try {
    const user = await requireUser("orders");
    const ok = await fn(user);
    revalidatePath("/", "layout");
    return { ok: ok || undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ------------------------- Locația care comandă ------------------------- */

export async function saveOrder(_: FormState, form: FormData): Promise<FormState> {
  let id = 0;
  const res = await run(async (user) => {
    const orderId = Number(form.get("order_id")) || null;
    const fromId = Number(form.get("from_location_id"));
    const toId = Number(form.get("to_location_id"));
    const neededFor = String(form.get("needed_for") ?? "");
    const note = String(form.get("note") ?? "").trim() || null;
    const submit = form.get("submit") === "1";
    const lines = readLines(form, "product_id", "qty").filter((l) => l.id && l.qty);
    if (!canOrder(user, fromId)) throw new Error("Doar managerul locației poate crea comenzi pentru această locație.");
    if (!toId || toId === fromId) throw new Error("Alegeți de unde se livrează.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neededFor)) throw new Error("Alegeți data la care aveți nevoie de produse.");
    if (!lines.length) throw new Error("Adăugați cel puțin un produs cu cantitate.");
    if (lines.some((l) => !Number.isFinite(l.qty!) || l.qty! <= 0)) throw new Error("Cantitățile trebuie să fie pozitive.");
    if (new Set(lines.map((l) => l.id)).size !== lines.length) throw new Error("Un produs apare de două ori.");

    id = await tx(async (tq) => {
      let oid = orderId;
      if (oid) {
        await lockOrder(tq, oid, ["draft"], (o) => canOrder(user, o.from_location_id));
        await tq("UPDATE location_orders SET from_location_id=$2, to_location_id=$3, needed_for=$4, note=$5 WHERE id=$1", [oid, fromId, toId, neededFor, note]);
        await tq("DELETE FROM location_order_lines WHERE order_id=$1", [oid]);
        await event(tq, oid, user.id, "change", null, "Ciorna a fost modificată.", { lines });
      } else {
        oid = (await tq<{ id: number }>(
          "INSERT INTO location_orders (from_location_id, to_location_id, needed_for, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [fromId, toId, neededFor, note, user.id]))[0].id;
        await event(tq, oid, user.id, "status", "draft", "Comandă creată.");
      }
      for (const l of lines) await tq("INSERT INTO location_order_lines (order_id, product_id, ordered_qty) VALUES ($1,$2,$3)", [oid, l.id, l.qty]);
      if (submit) {
        await tq("UPDATE location_orders SET status='submitted', submitted_at=now(), submitted_by=$2 WHERE id=$1", [oid, user.id]);
        await event(tq, oid, user.id, "status", "submitted", "Comanda a fost trimisă către furnizor.");
      }
      await audit({ userId: user.id, action: submit ? "order.submit" : "order.save", entity: "location_order", entityId: oid, details: { fromId, toId, neededFor, lines } }, tq);
      return oid;
    });
  });
  if (res.error) return res;
  redirect(`/comenzi/${id}`);
}

export async function submitOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    await tx(async (tq) => {
      await lockOrder(tq, id, ["draft"], (o) => canOrder(user, o.from_location_id));
      const n = (await tq<{ n: number }>("SELECT count(*)::int n FROM location_order_lines WHERE order_id=$1 AND ordered_qty > 0", [id]))[0].n;
      if (!n) throw new Error("Comanda nu are produse.");
      await tq("UPDATE location_orders SET status='submitted', submitted_at=now(), submitted_by=$2 WHERE id=$1", [id, user.id]);
      await event(tq, id, user.id, "status", "submitted", "Comanda a fost trimisă către furnizor.");
      await audit({ userId: user.id, action: "order.submit", entity: "location_order", entityId: id }, tq);
    });
    return "Comanda a fost trimisă.";
  });
}

/* ----------------------------- Furnizorul ----------------------------- */

/** Confirmarea poate modifica cantitățile; orice modificare cere un motiv și rămâne în istoric. */
export async function confirmOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const reason = String(form.get("reason") ?? "").trim() || null;
    const lines = readLines(form, "line_id", "confirmed_qty");
    if (lines.some((l) => l.qty == null || !Number.isFinite(l.qty) || l.qty < 0)) throw new Error("Completați cantitatea confirmată pentru fiecare produs (0 dacă nu se livrează).");
    await tx(async (tq) => {
      await lockOrder(tq, id, ["submitted"], (o) => canFulfil(user, o.to_location_id));
      const current = await tq<{ id: number; product: string; ordered: number }>(
        "SELECT l.id, p.name product, l.ordered_qty::float8 ordered FROM location_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id=$1", [id]);
      const changes = current.flatMap((c) => {
        const l = lines.find((x) => x.id === c.id);
        return l && Math.abs(l.qty! - c.ordered) > 1e-9 ? [`${c.product}: ${fmt(c.ordered)} → ${fmt(l.qty!)}`] : [];
      });
      if (changes.length && !reason) throw new Error("Ați modificat cantități: indicați motivul (ex: stoc insuficient în congelator).");
      for (const l of lines) await tq("UPDATE location_order_lines SET confirmed_qty=$3 WHERE id=$1 AND order_id=$2", [l.id, id, l.qty]);
      await tq("UPDATE location_orders SET status='confirmed', confirmed_at=now(), confirmed_by=$2 WHERE id=$1", [id, user.id]);
      await event(tq, id, user.id, "status", "confirmed",
        changes.length ? `Confirmată cu modificări: ${changes.join("; ")}. Motiv: ${reason}` : "Confirmată integral.", { lines, reason });
      await audit({ userId: user.id, action: "order.confirm", entity: "location_order", entityId: id, details: { changes, reason } }, tq);
    });
    return "Comanda a fost confirmată.";
  });
}

export async function startPreparing(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    await tx(async (tq) => {
      await lockOrder(tq, id, ["confirmed"], (o) => canFulfil(user, o.to_location_id));
      await tq("UPDATE location_orders SET status='preparing' WHERE id=$1", [id]);
      await event(tq, id, user.id, "status", "preparing", "Comanda este în pregătire.");
    });
    return "Comanda este în pregătire.";
  });
}

/**
 * Expedierea scade stocul furnizorului (cele mai vechi loturi întâi) și pune marfa „în tranzit”
 * până la recepție. Nu se poate expedia mai mult decât stocul operațional.
 */
export async function shipOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const lines = readLines(form, "line_id", "shipped_qty");
    if (lines.some((l) => l.qty == null || !Number.isFinite(l.qty) || l.qty < 0)) throw new Error("Completați cantitatea expediată pentru fiecare produs (0 dacă lipsește).");
    if (!lines.some((l) => l.qty! > 0)) throw new Error("Nu se expediază nimic. Anulați comanda dacă nu se mai livrează.");
    await tx(async (tq) => {
      const o = await lockOrder(tq, id, ["confirmed", "preparing"], (x) => canFulfil(user, x.to_location_id));
      const group = o.transfer_group ?? crypto.randomUUID();
      const current = await tq<{ id: number; product_id: number; product: string; confirmed: number }>(
        `SELECT l.id, l.product_id, p.name product, coalesce(l.confirmed_qty, l.ordered_qty)::float8 confirmed
           FROM location_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id=$1`, [id]);
      const diffs: string[] = [];
      for (const c of current) {
        const qty = lines.find((l) => l.id === c.id)?.qty ?? 0;
        await tq("UPDATE location_order_lines SET shipped_qty=$2 WHERE id=$1", [c.id, qty]);
        if (Math.abs(qty - c.confirmed) > 1e-9) diffs.push(`${c.product}: confirmat ${fmt(c.confirmed)}, expediat ${fmt(qty)}`);
        if (qty <= 0) continue;
        const lots = await tq<{ lot: string | null; qty: number; produced_on: string | null; expires_on: string | null }>(
          `SELECT lot, sum(qty)::float8 qty, min(produced_on) FILTER (WHERE qty > 0)::text produced_on, min(expires_on) FILTER (WHERE qty > 0)::text expires_on
             FROM stock_movements WHERE location_id = $1 AND product_id = $2
            GROUP BY lot HAVING sum(qty) > 0 ORDER BY 3 NULLS LAST, lot NULLS LAST`, [o.to_location_id, c.product_id]);
        const available = lots.reduce((s, l) => s + l.qty, 0);
        if (available + 1e-9 < qty) throw new Error(`Stoc insuficient pentru ${c.product}: disponibil ${fmt(available)}, se expediază ${fmt(qty)}. Verificați stocul sau reduceți cantitatea.`);
        let rest = qty;
        for (const l of lots) {
          if (rest <= 1e-9) break;
          const take = Math.min(rest, l.qty);
          await tq(
            `INSERT INTO stock_movements (location_id, product_id, qty, kind, counterpart_location_id, transfer_group, lot, produced_on, expires_on,
                                          document_ref, note, location_order_id, created_by)
             VALUES ($1,$2,$3,'transfer_out',$4,$5,$6,$7,$8,$9,'Expediere comandă',$10,$11)`,
            [o.to_location_id, c.product_id, -take, o.from_location_id, group, l.lot, l.produced_on, l.expires_on, `Comanda #${id}`, id, user.id]);
          rest -= take;
        }
      }
      await tq("UPDATE location_orders SET status='shipped', shipped_at=now(), shipped_by=$2, transfer_group=$3 WHERE id=$1", [id, user.id, group]);
      await event(tq, id, user.id, "status", "shipped", diffs.length ? `Expediată cu diferențe: ${diffs.join("; ")}.` : "Expediată conform confirmării.", { lines });
      await audit({ userId: user.id, action: "order.ship", entity: "location_order", entityId: id, details: { lines, diffs } }, tq);
    });
    return "Comanda a fost expediată. Stocul furnizorului a fost actualizat.";
  });
}

/* ------------------------------ Recepția ------------------------------ */

/**
 * Recepția intră în stocul locației pe aceleași loturi. Diferențele față de expediere se înregistrează explicit:
 * lipsă → pierdere la recepție, plus → ajustare, ambele legate de comandă.
 */
export async function receiveOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const note = String(form.get("note") ?? "").trim() || null;
    const lines = readLines(form, "line_id", "received_qty");
    if (lines.some((l) => l.qty == null || !Number.isFinite(l.qty) || l.qty < 0)) throw new Error("Completați cantitatea recepționată pentru fiecare produs.");
    await tx(async (tq) => {
      const o = await lockOrder(tq, id, ["shipped"], (x) => canReceive(user, x.from_location_id));
      const current = await tq<{ id: number; product_id: number; product: string; shipped: number }>(
        `SELECT l.id, l.product_id, p.name product, coalesce(l.shipped_qty,0)::float8 shipped
           FROM location_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id=$1`, [id]);
      const diffs = current.flatMap((c) => {
        const r = lines.find((l) => l.id === c.id)?.qty ?? 0;
        return Math.abs(r - c.shipped) > 1e-9 ? [`${c.product}: expediat ${fmt(c.shipped)}, recepționat ${fmt(r)}`] : [];
      });
      if (diffs.length && !note) throw new Error("Există diferențe față de cantitatea expediată: descrieți ce s-a întâmplat (ex: 3 buc deteriorate).");
      const mv = (productId: number, qty: number, kind: string, lot: string | null, produced: string | null, expires: string | null, text: string) =>
        tq(`INSERT INTO stock_movements (location_id, product_id, qty, kind, counterpart_location_id, transfer_group, lot, produced_on, expires_on,
                                         document_ref, note, location_order_id, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [o.from_location_id, productId, qty, kind, kind.startsWith("transfer") ? o.to_location_id : null, kind.startsWith("transfer") ? o.transfer_group : null,
           lot, produced, expires, `Comanda #${id}`, text, id, user.id]);

      for (const c of current) {
        const received = lines.find((l) => l.id === c.id)?.qty ?? 0;
        await tq("UPDATE location_order_lines SET received_qty=$2 WHERE id=$1", [c.id, received]);
        // Intrarea oglindește ieșirile din depozit, lot cu lot.
        const outs = await tq<{ lot: string | null; qty: number; produced_on: string | null; expires_on: string | null }>(
          `SELECT lot, -sum(qty)::float8 qty, min(produced_on)::text produced_on, min(expires_on)::text expires_on FROM stock_movements
            WHERE location_order_id = $1 AND kind = 'transfer_out' AND product_id = $2 GROUP BY lot ORDER BY 3 NULLS LAST`, [id, c.product_id]);
        for (const x of outs) await mv(c.product_id, x.qty, "transfer_in", x.lot, x.produced_on, x.expires_on, "Recepție comandă");
        const diff = received - c.shipped;
        if (diff < -1e-9) await mv(c.product_id, diff, "loss", outs.at(-1)?.lot ?? null, null, null, `Diferență la recepție: ${note}`);
        if (diff > 1e-9) await mv(c.product_id, diff, "adjustment", null, null, null, `Plus la recepție: ${note}`);
      }
      await tq("UPDATE location_orders SET status='received', received_at=now(), received_by=$2 WHERE id=$1", [id, user.id]);
      await event(tq, id, user.id, "status", "received", diffs.length ? `Recepționată cu diferențe: ${diffs.join("; ")}. ${note}` : `Recepționată integral.${note ? ` ${note}` : ""}`, { lines, note });
      await audit({ userId: user.id, action: "order.receive", entity: "location_order", entityId: id, details: { lines, diffs, note } }, tq);
    });
    return "Recepția a fost înregistrată. Stocul locației a fost actualizat.";
  });
}

/* ------------------------------ Diverse ------------------------------ */

export async function cancelOrder(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const reason = String(form.get("reason") ?? "").trim();
    await tx(async (tq) => {
      const o = await lockOrder(tq, id, ["draft", "submitted", "confirmed", "preparing"], (x) =>
        canFulfil(user, x.to_location_id) || (canOrder(user, x.from_location_id) && ["draft", "submitted"].includes(x.status)));
      if (o.status !== "draft" && !reason) throw new Error("Indicați motivul anulării.");
      await tq("UPDATE location_orders SET status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 WHERE id=$1", [id, user.id, reason || null]);
      await event(tq, id, user.id, "status", "cancelled", `Anulată${reason ? `: ${reason}` : "."}`);
      await audit({ userId: user.id, action: "order.cancel", entity: "location_order", entityId: id, details: { reason } }, tq);
    });
    return "Comanda a fost anulată.";
  });
}

export async function addComment(_: FormState, form: FormData): Promise<FormState> {
  return run(async (user) => {
    const id = Number(form.get("order_id"));
    const text = String(form.get("comment") ?? "").trim();
    if (!text) throw new Error("Scrieți comentariul.");
    const o = await one<{ from_location_id: number; to_location_id: number }>("SELECT from_location_id, to_location_id FROM location_orders WHERE id=$1", [id]);
    if (!o || !(canSeeLocation(user, o.from_location_id) || canSeeLocation(user, o.to_location_id))) throw new Error("Comanda nu există.");
    await tx((tq) => event(tq, id, user.id, "comment", null, text));
  });
}

/** Din necesarul comenzilor: creează un plan de producție în BRUTĂRIE pentru cantitățile lipsă. */
export async function planFromShortage(_: FormState, form: FormData): Promise<FormState> {
  let id = 0;
  const res = await run(async (user) => {
    if (!["admin", "production"].includes(user.role)) throw new Error("Doar responsabilul BRUTĂRIE poate planifica producția.");
    const freezerId = Number(form.get("freezer_location_id")) || null;
    const date = String(form.get("planned_for") ?? "");
    const lines = readLines(form, "product_id", "qty").filter((l) => l.id && l.qty && l.qty > 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Alegeți data producției.");
    if (!lines.length) throw new Error("Nu există lipsuri de planificat.");
    id = await tx(async (tq) => {
      const prod = (await tq<{ id: number }>("SELECT id FROM locations WHERE kind='production' AND active ORDER BY id LIMIT 1"))[0];
      if (!prod) throw new Error("Nu există o locație de producție.");
      const o = (await tq<{ id: number }>(
        "INSERT INTO production_orders (location_id, freezer_location_id, planned_for, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [prod.id, freezerId, date, "Generat din necesarul comenzilor locațiilor", user.id]))[0];
      for (const l of lines) {
        await tq(`INSERT INTO production_lines (order_id, product_id, planned_qty, recipe_id)
                  VALUES ($1,$2,$3,(SELECT id FROM recipes WHERE product_id=$2 AND active))`, [o.id, l.id, Math.ceil(l.qty!)]);
      }
      await audit({ userId: user.id, action: "production.plan_from_orders", entity: "production_order", entityId: o.id, details: { lines } }, tq);
      return o.id;
    });
  });
  if (res.error) return res;
  redirect(`/productie/${id}`);
}
