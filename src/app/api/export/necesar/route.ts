import { getUser, canAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { needs, purchasingLocations } from "@/lib/purchasing";
import { book, r2, sheet, xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Necesarul de comandat (Excel), pe locație sau pentru toate, grupat pe furnizor. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !canAccess(user, "purchasing")) return new Response("Neautorizat", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const locations = await purchasingLocations(user);
  const ids = sp.get("loc") === "all" ? locations.map((l) => l.id) : locations.filter((l) => l.id === Number(sp.get("loc"))).map((l) => l.id);
  const days = Math.min(Math.max(Number(sp.get("days")) || 3, 1), 31);
  const rows = await needs(ids, days);
  const data = rows.map((r) => ({
    "Locație": r.location, "Furnizor": r.supplier ?? "fără furnizor stabilit", "Produs": r.product, "UM": r.unit,
    "Stoc": r2(r.stock), "Minim": r2(r.min_qty), "Țintă": r2(r.target_qty), "Necesar producție": r2(r.production_need),
    "De comandat": r2(r.suggested), "Preț estimat (lei)": r2(r.last_price), "Valoare estimată (lei)": r2(r.suggested * (r.last_price ?? 0)),
  }));
  await audit({ userId: user.id, action: "export.needs", details: { ids, days } });
  return xlsxResponse(book([["Necesar", sheet(data, "Nimic de comandat")]]), `Necesar_comenzi_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
