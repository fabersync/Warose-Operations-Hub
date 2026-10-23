"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canSeeLocation } from "@/lib/auth";
import { cancelUse, recordUses, type UseKind } from "@/lib/internal";

export type UseState = { ok?: string; error?: string; at?: number };
const numv = (v: FormDataEntryValue) => { const s = String(v).trim().replace(",", "."); return s === "" ? null : Number(s); };

export async function saveUses(_: UseState, form: FormData): Promise<UseState> {
  try {
    const user = await requireUser("consumption");
    const kind = String(form.get("kind")) as UseKind;
    if (!["staff", "protocol", "loss"].includes(kind)) throw new Error("Tip necunoscut.");
    const locationId = Number(form.get("location_id"));
    const date = String(form.get("date") ?? "");
    const person = String(form.get("person") ?? "").trim() || null;
    const reason = String(form.get("reason") ?? "").trim() || null;
    if (!locationId || !canSeeLocation(user, locationId)) throw new Error("Alegeți o locație la care aveți acces.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Alegeți data.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
    if (date > today) throw new Error("Data nu poate fi în viitor.");
    if (kind === "staff" && !person) throw new Error("Completați numele angajatului.");
    if (kind === "protocol" && !reason && !person) throw new Error("Completați beneficiarul sau motivul protocolului.");
    const ids = form.getAll("product_id").map(Number);
    const qtys = form.getAll("qty").map(numv);
    const lines = ids.map((productId, i) => ({ productId, qty: qtys[i] })).filter((l) => l.productId && l.qty != null) as { productId: number; qty: number }[];
    if (lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) throw new Error("Cantitățile trebuie să fie numere pozitive.");
    if (!lines.length) throw new Error("Completați cantitatea la cel puțin un produs.");
    const r = await recordUses(user, { locationId, kind, date, person, reason, lines });
    revalidatePath("/", "layout");
    const value = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(r.value);
    return { ok: `Am înregistrat ${r.lines} ${r.lines === 1 ? "produs" : "produse"} · ${value} la cost.`, at: Date.now() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelUseAction(form: FormData) {
  const user = await requireUser("consumption");
  await cancelUse(user, Number(form.get("use_id")));
  revalidatePath("/", "layout");
}
