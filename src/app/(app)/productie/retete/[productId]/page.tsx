import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { activeRecipe, canEditProduction, recipeHistory } from "@/lib/production";
import { Badge, Card, Notice } from "@/components/ui";
import { RecipeEditor } from "../../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rețetă" };

export default async function RecipePage({ params }: { params: Promise<{ productId: string }> }) {
  const user = await requireUser("production");
  const productId = Number((await params).productId);
  const product = await one<{ id: number; name: string; unit: string }>("SELECT id, name, unit FROM products WHERE id=$1", [productId]);
  if (!product) notFound();
  const [recipe, history, ingredients] = await Promise.all([
    activeRecipe(productId),
    recipeHistory(productId),
    q<{ id: number; name: string; unit: string; cost_price: number | null }>(
      "SELECT id, name, unit, cost_price::float8 cost_price FROM products WHERE active AND id <> $1 AND category IN ('raw','packaging','finished','merchandise') ORDER BY category IN ('finished','merchandise'), name",
      [productId],
    ),
  ]);
  const edit = canEditProduction(user);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/productie/retete" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Rețete</Link>
          <h2 className="text-xl font-semibold tracking-tight text-ink">{product.name}</h2>
          <p className="text-sm text-muted">{recipe ? <>Versiunea activă v{recipe.version}, de {recipe.author}, {fmtDateTime(recipe.created_at)}</> : "Nu există încă o rețetă."}</p>
        </div>
      </div>

      {!ingredients.length && <Notice tone="warn">Nu există materii prime în catalog. Adăugați-le din Produse & coduri cu categoria „Materie primă”.</Notice>}

      <Card title={recipe ? "Rețeta activă" : "Rețetă nouă"} subtitle="Cantitățile sunt în unitatea fiecărei materii prime, pentru întregul randament">
        <RecipeEditor
          productId={productId}
          unit={product.unit}
          readOnly={!edit}
          ingredients={ingredients}
          initial={recipe ? { yield_qty: recipe.yield_qty, note: recipe.note, items: recipe.items.map((i) => ({ ingredient_id: i.ingredient_id, qty: i.qty })) } : null}
        />
      </Card>

      {history.length > 0 && (
        <Card title="Istoric versiuni" subtitle="Documentele de producție rămân legate de versiunea folosită" pad={false}>
          <table className="table">
            <thead><tr><th>Versiune</th><th className="num">Randament</th><th className="num">Ingrediente</th><th>Autor</th><th>Data</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>v{h.version} {h.active && <Badge tone="good">activă</Badge>}</td>
                  <td className="num">{h.yield_qty}</td>
                  <td className="num">{h.items}</td>
                  <td>{h.author}</td>
                  <td className="text-xs">{fmtDateTime(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
