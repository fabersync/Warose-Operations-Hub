import { Boxes, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtNum, fmtDateTime } from "@/lib/format";
import { locationsFor, recentMovements, stockLevels } from "@/lib/queries";
import { Card, EmptyState, Notice, PageHeader, Badge } from "@/components/ui";
import { MovementForm } from "@/components/MovementForm";
import { MovementTable } from "@/components/MovementTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocuri" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const user = await requireUser("stock");
  const sp = await searchParams;
  const locationId = sp.loc ? Number(sp.loc) : null;
  const [locations, products, levels, moves] = await Promise.all([
    locationsFor(user),
    q<{ id: number; name: string; unit: string }>("SELECT id, name, unit FROM products WHERE active ORDER BY name"),
    stockLevels(user, { locationId }),
    recentMovements(user, { locationId, limit: 40 }),
  ]);

  return (
    <>
      <PageHeader
        title="Stocuri"
        description="Stoc operațional calculat exclusiv din mișcările înregistrate. Nu este stocul contabil din SAGA C și nu este prezentat ca sincronizat cu acesta."
        actions={<a href={`/api/export/stock${locationId ? `?loc=${locationId}` : ""}`} className="btn btn-ghost"><Download className="size-4" />Export Excel</a>}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        <a href="/stocuri" className={`rounded-md px-3 py-1.5 text-xs font-medium ${!locationId ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>Toate</a>
        {locations.map((l) => (
          <a key={l.id} href={`/stocuri?loc=${l.id}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${locationId === l.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</a>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Stoc operațional curent" subtitle={`${levels.length} poziții`} pad={false}>
          {levels.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Produs</th><th>Locație</th><th className="num">Stoc</th><th>Ultima mișcare</th></tr></thead>
                <tbody>
                  {levels.map((s) => (
                    <tr key={`${s.location_id}-${s.product_id}`}>
                      <td className="font-medium text-ink">{s.product}</td>
                      <td className="text-xs">{s.location}</td>
                      <td className="num">{s.qty < 0 ? <Badge tone="bad">{fmtNum(s.qty)} {s.unit}</Badge> : <>{fmtNum(s.qty)} <span className="text-muted">{s.unit}</span></>}</td>
                      <td className="text-xs text-muted">{fmtDateTime(s.last_move)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Boxes className="size-5" />} title="Nicio mișcare de stoc">Înregistrați prima recepție sau intrare din producție folosind formularul.</EmptyState>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Înregistrează o operațiune">
            {products.length ? (
              <MovementForm locations={locations} products={products} defaultLocationId={locationId ?? locations[0]?.id} />
            ) : (
              <Notice tone="info">Catalogul de produse este gol. Produsele apar automat după primul import Publine sau pot fi adăugate din „Produse & coduri”.</Notice>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Istoric mișcări" subtitle="Ultimele 40 · mișcările nu se șterg, se stornează" pad={false}>
        {moves.length ? <MovementTable rows={moves} /> : <EmptyState title="Fără istoric încă" />}
      </Card>
    </>
  );
}
