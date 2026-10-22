import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { addDays, todayLocal } from "@/lib/format";
import { canEditProduction } from "@/lib/production";
import { locationsFor } from "@/lib/queries";
import { Card } from "@/components/ui";
import { PlanForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan de producție" };

export default async function NewPlanPage() {
  const user = await requireUser("production");
  if (!canEditProduction(user)) redirect("/productie");
  const [products, prod, freezers] = await Promise.all([
    q<{ id: number; name: string; unit: string; has_recipe: boolean }>(
      `SELECT p.id, p.name, p.unit, EXISTS (SELECT 1 FROM recipes r WHERE r.product_id = p.id AND r.active) has_recipe
         FROM products p WHERE p.active AND p.category = 'finished' ORDER BY has_recipe DESC, p.name`,
    ),
    locationsFor(user, ["production"]),
    locationsFor(user, ["freezer"]),
  ]);
  return (
    <Card title="Plan de producție nou" subtitle="Doar produsele cu categoria „Produs finit”; cele cu rețetă apar primele">
      <PlanForm products={products} locations={prod} freezers={freezers} defaultDate={addDays(todayLocal(), 1)} />
    </Card>
  );
}
