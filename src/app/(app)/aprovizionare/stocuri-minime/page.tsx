import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { canPurchase, locationSuppliers, purchasingLocations } from "@/lib/purchasing";
import { Card, Notice, PageHeader } from "@/components/ui";
import { TargetsForm } from "../Forms";
import { setLocationSupplier } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocuri minime și furnizori" };

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const user = await requireUser("purchasing");
  const locations = await purchasingLocations(user);
  const wanted = Number((await searchParams).loc);
  const loc = locations.find((l) => l.id === wanted) ?? locations[0];
  const [rows, sup, allSuppliers] = loc ? await Promise.all([
    q<{ id: number; name: string; unit: string; stock: number; min_qty: number | null; target_qty: number | null; supplier_id: number | null }>(
      `SELECT p.id, p.name, p.unit,
              coalesce((SELECT sum(qty) FROM stock_movements m WHERE m.location_id = $1 AND m.product_id = p.id), 0)::float8 stock,
              t.min_qty::float8 min_qty, t.target_qty::float8 target_qty, t.supplier_id
         FROM products p LEFT JOIN stock_targets t ON t.product_id = p.id AND t.location_id = $1
        WHERE p.active AND (p.track_stock OR t.product_id IS NOT NULL OR p.category IN ('raw','packaging'))
        ORDER BY (t.product_id IS NULL), p.name`, [loc.id]),
    locationSuppliers([loc.id]),
    q<{ id: number; name: string }>("SELECT id, name FROM suppliers ORDER BY name"),
  ]) : [[], [], []];
  const editable = !!loc && canPurchase(user, loc.id);
  const mine = new Set(sup.map((s) => s.supplier_id));
  // În lista din tabel: întâi furnizorii locației.
  const supplierOptions = [...sup.map((s) => ({ id: s.supplier_id, name: `★ ${s.name}` })), ...allSuppliers.filter((s) => !mine.has(s.id))];

  return (
    <>
      <PageHeader title="Stocuri minime și furnizori" description="Pentru fiecare locație: de la ce furnizori comandă, sub ce cantitate trebuie comandat un produs, până la ce nivel și de la cine. Stocul actual este cel operațional din aplicație."
        actions={<Link href={`/aprovizionare/necesar?loc=${loc?.id ?? ""}`} className="btn btn-ghost"><ArrowLeft className="size-4" />Necesar comenzi</Link>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {locations.map((l) => (
          <Link key={l.id} href={`/aprovizionare/stocuri-minime?loc=${l.id}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${l.id === loc?.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</Link>
        ))}
      </div>
      {loc && editable ? (
        <div className="space-y-4">
          <Card title={`Furnizorii · ${loc.name}`} subtitle="Apar primii în comenzi și au prioritate la alegerea automată a furnizorului unui produs">
            <div className="flex flex-wrap items-center gap-2">
              {sup.map((s) => (
                <form key={s.supplier_id} action={setLocationSupplier} className="inline-flex items-center gap-1 rounded-full bg-crust-soft py-1 pl-3 pr-1 text-xs font-medium text-crust">
                  <input type="hidden" name="location_id" value={loc.id} /><input type="hidden" name="supplier_id" value={s.supplier_id} /><input type="hidden" name="op" value="remove" />
                  {s.name}
                  <button className="rounded-full p-0.5 hover:bg-crust/15" aria-label={`Scoate ${s.name}`} title="Scoate din listă"><X className="size-3.5" /></button>
                </form>
              ))}
              {!sup.length && <span className="text-sm text-muted">Niciun furnizor ales încă.</span>}
              <form action={setLocationSupplier} className="ml-auto flex items-center gap-2">
                <input type="hidden" name="location_id" value={loc.id} />
                <select name="supplier_id" defaultValue="" className="input w-64 py-1.5 text-xs" aria-label="Adaugă furnizor">
                  <option value="" disabled>Adaugă un furnizor…</option>
                  {allSuppliers.filter((s) => !mine.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="btn btn-ghost py-1.5 text-xs">Adaugă</button>
              </form>
            </div>
          </Card>
          <Card title={`Stocuri minime · ${loc.name}`}><TargetsForm locationId={loc.id} rows={rows} suppliers={supplierOptions} /></Card>
        </div>
      ) : <Notice>Nu aveți dreptul să modificați stocurile minime ale acestei locații.</Notice>}
    </>
  );
}
