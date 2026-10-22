import Link from "next/link";
import { Plus, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtNum, fmtRon } from "@/lib/format";
import { canPurchase, listPurchaseOrders, PO_STATUS, purchasingLocations, suggestions } from "@/lib/purchasing";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comenzi furnizori" };

const FILTERS = [{ v: "open", l: "Active" }, { v: "delivered", l: "Livrate" }, { v: "cancelled", l: "Anulate" }, { v: "all", l: "Toate" }];

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ s?: string; loc?: string }> }) {
  const user = await requireUser("purchasing");
  const sp = await searchParams;
  const s = sp.s ?? "open";
  const locations = await purchasingLocations(user);
  const loc = locations.find((l) => l.id === Number(sp.loc)) ?? locations[0];
  const [orders, sugg] = await Promise.all([listPurchaseOrders(user, s), loc ? suggestions(loc.id) : Promise.resolve([])]);
  const bySupplier = new Map<string, typeof sugg>();
  for (const x of sugg) { const k = x.supplier_id ? String(x.supplier_id) : "-"; bySupplier.set(k, [...(bySupplier.get(k) ?? []), x]); }

  return (
    <>
      <PageHeader title="Comenzi furnizori" description="Comenzile de materii prime și marfă pentru Sibiu, Alba Iulia și BRUTĂRIE (Metro, distribuitori). Propunerile pornesc de la stocurile minime; stocul se actualizează la verificarea facturii."
        actions={loc && canPurchase(user, loc.id) ? <Link href={`/aprovizionare/nou?loc=${loc.id}`} className="btn btn-primary"><Plus className="size-4" />Comandă nouă</Link> : undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {locations.map((l) => (
          <Link key={l.id} href={`/aprovizionare?loc=${l.id}&s=${s}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${l.id === loc?.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</Link>
        ))}
        {loc && <Link href={`/aprovizionare/stocuri-minime?loc=${loc.id}`} className="btn btn-ghost ml-auto py-1.5"><SlidersHorizontal className="size-4" />Stocuri minime</Link>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Comenzi" pad={false} action={
          <div className="flex gap-1">{FILTERS.map((f) => <Link key={f.v} href={`/aprovizionare?loc=${loc?.id ?? ""}&s=${f.v}`} className={`rounded-md px-2 py-1 text-xs font-medium ${s === f.v ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"}`}>{f.l}</Link>)}</div>}>
          {orders.length ? (
            <table className="table">
              <thead><tr><th>#</th><th>Furnizor</th><th>Livrare la</th><th>Data dorită</th><th className="num">Produse</th><th className="num">Estimat</th><th>Stare</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/aprovizionare/${o.id}`} className="font-medium text-crust">#{o.id}</Link></td>
                    <td className="font-medium text-ink">{o.supplier}</td>
                    <td className="text-xs">{o.location}</td>
                    <td className="whitespace-nowrap text-xs">{o.needed_for ? fmtDate(o.needed_for) : "—"}</td>
                    <td className="num">{o.lines}</td>
                    <td className="num">{o.est_total ? fmtRon(o.est_total) : "—"}</td>
                    <td><Badge tone={PO_STATUS[o.status].tone}>{PO_STATUS[o.status].label}</Badge>{o.invoice_id && <span className="ml-1 text-xs text-muted">· factură</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<ShoppingCart className="size-5" />} title="Nicio comandă în această listă">Creați o comandă sau porniți de la propunerile din dreapta.</EmptyState>}
        </Card>

        <Card title={`De comandat · ${loc?.name ?? ""}`} subtitle="Produse sub stocul minim, grupate pe furnizorul obișnuit">
          {sugg.length ? (
            <div className="space-y-4">
              {[...bySupplier.entries()].map(([k, items]) => (
                <div key={k}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{items[0].supplier ?? "Furnizor necunoscut"}</span>
                    {loc && canPurchase(user, loc.id) && (
                      <Link href={`/aprovizionare/nou?loc=${loc.id}&from=suggest${items[0].supplier_id ? `&supplier=${items[0].supplier_id}` : ""}`} className="text-xs font-medium text-crust">Creează comanda →</Link>
                    )}
                  </div>
                  <ul className="space-y-1 text-sm">
                    {items.map((x) => (
                      <li key={x.product_id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate text-ink-2">{x.product}</span>
                        <span className="shrink-0 tabular-nums text-xs"><span className="text-bad">{fmtNum(x.stock)}</span> / min {fmtNum(x.min_qty)} → <b>{fmtNum(x.suggested)} {x.unit}</b></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Nimic sub minim. Setați stocurile minime ale locației ca aplicația să propună comenzile.</p>
          )}
        </Card>
      </div>
    </>
  );
}
