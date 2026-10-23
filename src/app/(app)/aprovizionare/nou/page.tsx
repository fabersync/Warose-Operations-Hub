import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { addDays, todayLocal } from "@/lib/format";
import { canPurchase, purchasingLocations, suggestions } from "@/lib/purchasing";
import { Card, Notice, PageHeader } from "@/components/ui";
import { PurchaseOrderForm, SupplierForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comandă nouă către furnizor" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ loc?: string; supplier?: string; from?: string; days?: string }> }) {
  const user = await requireUser("purchasing");
  const sp = await searchParams;
  const locations = (await purchasingLocations(user)).filter((l) => canPurchase(user, l.id));
  if (!locations.length) redirect("/aprovizionare");
  const loc = locations.find((l) => l.id === Number(sp.loc)) ?? locations[0];
  const supplierId = Number(sp.supplier) || null;
  const [suppliers, products, sugg] = await Promise.all([
    // Furnizorii obișnuiți ai locației apar primii.
    q<{ id: number; name: string }>(
      `SELECT s.id, CASE WHEN ls.supplier_id IS NOT NULL THEN '★ ' ELSE '' END || s.name name FROM suppliers s
         LEFT JOIN location_suppliers ls ON ls.supplier_id = s.id AND ls.location_id = $1
        ORDER BY ls.supplier_id IS NULL, s.name`, [loc.id]),
    q<{ id: number; name: string; unit: string; cost_price: number | null }>(
      "SELECT id, name, unit, cost_price::float8 cost_price FROM products WHERE active ORDER BY category IN ('raw','packaging') DESC, name"),
    sp.from === "suggest" ? suggestions(loc.id, Number(sp.days) || 3) : Promise.resolve([]),
  ]);
  // Din propuneri: produsele sub minim ale furnizorului ales, cu cantitatea până la nivelul țintă.
  const lines = sugg.filter((x) => (supplierId ? x.supplier_id === supplierId : !x.supplier_id) && x.suggested > 0)
    .map((x) => ({ product_id: x.product_id, qty: Math.ceil(x.suggested * 100) / 100 }));
  return (
    <>
      <PageHeader title="Comandă nouă către furnizor" actions={<Link href="/aprovizionare" className="btn btn-ghost"><ArrowLeft className="size-4" />Comenzi furnizori</Link>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card subtitle={lines.length ? `Completată din necesar: ${lines.length} produse (sub stocul minim sau pentru producția planificată)` : undefined}>
          <PurchaseOrderForm locations={locations} suppliers={suppliers} products={products}
            initial={{ location_id: loc.id, supplier_id: supplierId, needed_for: addDays(todayLocal(), 1), note: null, lines }} />
        </Card>
        <div className="space-y-4">
          <Card title="Furnizor nou"><SupplierForm /></Card>
          <Notice>Furnizorii apar automat și din facturile importate (e-Factura). Prețul estimat este ultimul preț de achiziție din facturi.</Notice>
        </div>
      </div>
    </>
  );
}
