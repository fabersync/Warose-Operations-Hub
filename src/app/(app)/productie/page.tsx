import Link from "next/link";
import { ChefHat, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtNum, todayLocal, addDays } from "@/lib/format";
import { canEditProduction, listOrders, ORDER_STATUS, requirementsFor } from "@/lib/production";
import { Badge, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Producție" };

export default async function ProductionPage() {
  const user = await requireUser("production");
  const orders = await listOrders(user);
  const today = todayLocal();
  const horizon = addDays(today, 7);

  // Necesarul cumulat pentru tot ce este planificat în următoarele 7 zile, pe locația de producție.
  const planned = await q<{ location_id: number; location: string; product_id: number; qty: number }>(
    `SELECT o.location_id, l.name location, pl.product_id, sum(pl.planned_qty)::float8 qty
       FROM production_orders o JOIN production_lines pl ON pl.order_id = o.id JOIN locations l ON l.id = o.location_id
      WHERE o.status = 'planned' AND o.planned_for BETWEEN $1::date AND $2::date
      GROUP BY o.location_id, l.name, pl.product_id`,
    [addDays(today, -1), horizon],
  );
  const byLoc = new Map<number, { location: string; lines: { product_id: number; qty: number }[] }>();
  for (const p of planned) {
    const e = byLoc.get(p.location_id) ?? { location: p.location, lines: [] };
    e.lines.push({ product_id: p.product_id, qty: p.qty });
    byLoc.set(p.location_id, e);
  }
  const reqs = await Promise.all([...byLoc.entries()].map(async ([locId, e]) => ({ location: e.location, rows: await requirementsFor(e.lines, locId) })));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Documente de producție" subtitle="Planificat → De aprobat → Aprobat (intră în stoc) → Înregistrat în SAGA"
          action={canEditProduction(user) ? <Link href="/productie/nou" className="btn btn-primary py-1.5"><Plus className="size-4" />Plan nou</Link> : undefined} pad={false}>
          {orders.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>#</th><th>Data</th><th>Locație</th><th className="num">Produse</th><th className="num">Planificat</th><th className="num">Produs</th><th>Stare</th><th>SAGA</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/productie/${o.id}`} className="font-medium text-crust hover:text-crust-strong">#{o.id}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(o.planned_for)}</td>
                      <td className="text-xs">{o.location}</td>
                      <td className="num">{o.lines}</td>
                      <td className="num">{fmtNum(o.planned)}</td>
                      <td className="num">{o.produced != null ? fmtNum(o.produced) : "—"}</td>
                      <td><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></td>
                      <td className="text-xs">{o.saga_doc_no ? <Badge tone="good">nr. {o.saga_doc_no}</Badge> : o.status === "approved" ? <Badge tone="warn">de introdus</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<ChefHat className="size-5" />} title="Niciun document de producție"
              action={canEditProduction(user) ? <Link href="/productie/nou" className="btn btn-primary">Creează primul plan</Link> : undefined}>
              Planificați producția pe zile; aplicația calculează necesarul de materii prime din rețete.
            </EmptyState>
          )}
        </Card>

        <Card title="Necesar materii prime" subtitle={`Pentru planurile din ${fmtDate(today)} – ${fmtDate(horizon)}`}>
          {reqs.length ? reqs.map((r) => (
            <div key={r.location} className="mb-4 last:mb-0">
              <div className="eyebrow mb-2">{r.location}</div>
              {r.rows.length ? (
                <ul className="space-y-2 text-sm">
                  {r.rows.map((x) => {
                    const short = x.track_stock && x.available < x.needed;
                    return (
                      <li key={x.ingredient_id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-ink-2">{x.name}</span>
                        <span className="flex shrink-0 items-center gap-2 tabular-nums">
                          {fmtNum(Math.round(x.needed * 1000) / 1000)} {x.unit}
                          {x.track_stock
                            ? short ? <Badge tone="bad">lipsă {fmtNum(Math.round((x.needed - x.available) * 1000) / 1000)}</Badge> : <Badge tone="good">în stoc</Badge>
                            : <Badge>stoc negestionat</Badge>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted">Produsele planificate nu au rețete.</p>}
            </div>
          )) : <p className="text-sm text-muted">Nimic planificat în următoarele 7 zile.</p>}
        </Card>
      </div>
    </div>
  );
}
