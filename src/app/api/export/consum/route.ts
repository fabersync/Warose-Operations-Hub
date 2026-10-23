import { getUser, canAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { listUses, USE_KINDS, type UseKind } from "@/lib/internal";
import { book, r2, sheet, xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export Excel: consum personal, protocol sau pierderi (?kind=, sau toate), pe perioadă și locație. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "consumption")) return new Response("Neautorizat", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
  const from = isDate(sp.get("from")) ? sp.get("from")! : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.get("to")) ? sp.get("to")! : today;
  const kind = sp.get("kind") as UseKind | null;
  const kinds = kind && kind in USE_KINDS ? [kind] : (Object.keys(USE_KINDS) as UseKind[]);
  const rows = await listUses(user, { from, to, locationId: Number(sp.get("loc")) || null, kinds });

  const detail = rows.map((r) => ({
    "Data": r.use_date, "Locație": r.location, "Tip": USE_KINDS[r.kind].label, "Produs": r.product, "Cantitate": r.qty, "UM": r.unit,
    "Cost unitar (lei)": r2(r.unit_cost), "Valoare la cost (lei)": r2(r.cost), "Sursa costului": r.cost_source === "recipe" ? "rețetă (producție)" : r.cost_source === "purchase" ? "preț achiziție" : "lipsă",
    "Preț vânzare fără TVA (lei)": r2(r.unit_price), "Valoare la vânzare (lei)": r2(r.sale_value),
    "Angajat / beneficiar": r.person ?? "", "Motiv": r.reason ?? "", "Introdus de": r.author,
  }));
  const agg = (key: (r: (typeof rows)[number]) => string, label: string) => {
    const m = new Map<string, { qty: number; cost: number; sale: number; n: number; unit: string }>();
    for (const r of rows) { const k = key(r); const x = m.get(k) ?? { qty: 0, cost: 0, sale: 0, n: 0, unit: r.unit }; x.qty += r.qty; x.cost += r.cost ?? 0; x.sale += r.sale_value ?? 0; x.n++; m.set(k, x); }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => ({ [label]: k, "Înregistrări": v.n, "Cantitate": r2(v.qty), "Valoare la cost (lei)": r2(v.cost), "Valoare la vânzare (lei)": r2(v.sale) }));
  };
  const wb = book([
    ["Detaliu", sheet(detail)],
    ["Pe produs", sheet(agg((r) => r.product, "Produs"))],
    ["Pe angajat-beneficiar", sheet(agg((r) => `${r.person || "—"} (${USE_KINDS[r.kind].label})`, "Angajat / beneficiar"))],
    ["Pe zi", sheet(agg((r) => `${r.use_date} · ${USE_KINDS[r.kind].label}`, "Zi"))],
    ["Pe locație", sheet(agg((r) => `${r.location} · ${USE_KINDS[r.kind].label}`, "Locație"))],
  ]);
  await audit({ userId: user.id, action: "export.consumption", details: { kinds, from, to } });
  const name = kinds.length === 1 ? USE_KINDS[kinds[0]].label.replace(/\s+/g, "_") : "Consum_si_pierderi";
  return xlsxResponse(wb, `${name}_${from}_${to}.xlsx`);
}
