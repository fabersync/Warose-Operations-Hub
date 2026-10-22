import Link from "next/link";
import { ChefHat } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtRon } from "@/lib/format";
import { canEditProduction, recipeList } from "@/lib/production";
import { Badge, Card, EmptyState, Notice } from "@/components/ui";
import { setCostPrice } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rețete" };

export default async function RecipesPage() {
  const user = await requireUser("production");
  const edit = canEditProduction(user);
  const [recipes, raw] = await Promise.all([
    recipeList(),
    q<{ id: number; name: string; unit: string; cost_price: number | null; cost_updated_at: string | null; used_in: number; track_stock: boolean }>(
      `SELECT p.id, p.name, p.unit, p.cost_price::float8 cost_price, p.cost_updated_at, p.track_stock,
              (SELECT count(DISTINCT r.product_id)::int FROM recipe_items i JOIN recipes r ON r.id = i.recipe_id AND r.active WHERE i.ingredient_id = p.id) used_in
         FROM products p WHERE p.active AND p.category IN ('raw','packaging') ORDER BY p.name`,
    ),
  ]);
  const withRecipe = recipes.filter((r) => r.recipe_id);
  const without = recipes.filter((r) => !r.recipe_id);

  return (
    <div className="space-y-4">
      <Notice title="Cost teoretic și marjă estimată">
        Costul provine din rețetă × prețul de achiziție al materiilor prime și nu include manopera, energia sau alte cheltuieli. Marja estimată compară acest cost cu prețul de vânzare fără TVA din Publine — nu reprezintă profitul real.
      </Notice>

      <Card title="Rețete active" subtitle={`${withRecipe.length} produse cu rețetă · ${without.length} produse finite fără rețetă`} pad={false}>
        {recipes.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Produs</th><th>Versiune</th><th className="num">Randament</th><th className="num">Cost / buc</th><th className="num">Preț fără TVA</th><th className="num">Marjă estimată</th><th></th></tr></thead>
              <tbody>
                {recipes.map((r) => {
                  const unitCost = r.batch_cost != null && r.yield_qty ? r.batch_cost / r.yield_qty : null;
                  const net = r.sale_price != null ? r.sale_price / (1 + (r.vat_rate ?? 0) / 100) : null;
                  const margin = unitCost != null && net ? ((net - unitCost) / net) * 100 : null;
                  return (
                    <tr key={r.product_id}>
                      <td className="font-medium text-ink">{r.product}</td>
                      <td>{r.recipe_id ? <Badge>v{r.version} · {r.items} ingrediente</Badge> : <Badge tone="warn">fără rețetă</Badge>}</td>
                      <td className="num">{r.yield_qty ? `${r.yield_qty} ${r.unit}` : "—"}</td>
                      <td className="num">
                        {unitCost != null ? fmtRon(unitCost, true) : "—"}
                        {r.missing_prices > 0 && <div className="text-xs text-warn">{r.missing_prices} fără preț</div>}
                      </td>
                      <td className="num text-muted">{net != null ? fmtRon(net, true) : "—"}</td>
                      <td className="num">
                        {margin != null && r.missing_prices === 0
                          ? <Badge tone={margin < 50 ? "bad" : margin < 65 ? "warn" : "good"}>{Math.round(margin)}%</Badge>
                          : <span className="text-faint">—</span>}
                      </td>
                      <td className="text-right"><Link href={`/productie/retete/${r.product_id}`} className="text-sm font-medium text-crust hover:text-crust-strong">{r.recipe_id ? (edit ? "Editează" : "Vezi") : edit ? "Creează" : ""}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<ChefHat className="size-5" />} title="Niciun produs finit">
            Marcați produsele fabricate în BRUTĂRIE cu categoria „Produs finit” în Produse & coduri, apoi creați rețetele aici.
          </EmptyState>
        )}
      </Card>

      <Card title="Materii prime și prețuri de achiziție" subtitle="Prețul pe unitatea de măsură a materiei prime (ex: lei/kg). Se va actualiza automat din facturi în Etapa 6." pad={false}>
        {raw.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Materie primă</th><th>UM</th><th className="num">Folosită în</th><th>Stoc gestionat</th><th>Preț achiziție (fără TVA)</th><th>Actualizat</th></tr></thead>
              <tbody>
                {raw.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-ink">{p.name}</td>
                    <td className="text-xs">{p.unit}</td>
                    <td className="num">{p.used_in} rețete</td>
                    <td>{p.track_stock ? <Badge tone="good">da</Badge> : <Badge>nu</Badge>}</td>
                    <td>
                      {edit ? (
                        <form action={setCostPrice} className="flex items-center gap-1.5">
                          <input type="hidden" name="product_id" value={p.id} />
                          <input name="cost_price" defaultValue={p.cost_price != null ? String(p.cost_price).replace(".", ",") : ""} inputMode="decimal" placeholder="lei" aria-label={`Preț ${p.name}`} className="input w-24 py-1 text-right text-xs" />
                          <span className="text-xs text-muted">lei/{p.unit}</span>
                          <button className="btn btn-ghost px-2 py-1 text-xs">Salvează</button>
                        </form>
                      ) : p.cost_price != null ? fmtRon(p.cost_price, true) : "—"}
                    </td>
                    <td className="text-xs text-muted">{p.cost_updated_at ? fmtDate(p.cost_updated_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nicio materie primă în catalog">Adăugați-le din Produse & coduri cu categoria „Materie primă” (ex: FĂINĂ 000, kg).</EmptyState>
        )}
      </Card>
    </div>
  );
}
