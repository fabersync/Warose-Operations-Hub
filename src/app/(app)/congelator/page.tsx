import { Download, Snowflake } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { daysBetween, fmtDate, fmtNum, todayLocal } from "@/lib/format";
import { locationsFor, lotBalances, recentMovements } from "@/lib/queries";
import { Badge, Card, EmptyState, Kpi, Notice, PageHeader } from "@/components/ui";
import { MovementForm } from "@/components/MovementForm";
import { MovementTable } from "@/components/MovementTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Congelator" };

export default async function FreezerPage() {
  const user = await requireUser("freezer");
  const all = await locationsFor(user);
  const freezer = all.find((l) => l.kind === "freezer");
  if (!freezer) {
    return (
      <>
        <PageHeader title="Congelator" />
        <Notice tone="warn">Nu aveți acces la depozitul de produse congelate sau acesta nu este configurat.</Notice>
      </>
    );
  }
  const today = todayLocal();
  const [lots, moves, products, shipped] = await Promise.all([
    lotBalances(user, freezer.id),
    recentMovements(user, { locationId: freezer.id, limit: 30 }),
    q<{ id: number; name: string; unit: string }>("SELECT id, name, unit FROM products WHERE active ORDER BY is_frozen DESC, name"),
    q<{ location: string; product: string; unit: string; qty: number }>(
      `SELECT l.name location, p.name product, p.unit, sum(-m.qty)::float8 qty
         FROM stock_movements m JOIN locations l ON l.id = m.counterpart_location_id JOIN products p ON p.id = m.product_id
        WHERE m.location_id = $1 AND m.kind = 'transfer_out' AND m.occurred_at > now() - interval '30 days'
          AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_id = m.id)
        GROUP BY l.name, p.name, p.unit ORDER BY l.name, qty DESC`,
      [freezer.id],
    ),
  ]);

  const byProduct = new Map<string, { product: string; unit: string; qty: number; lots: typeof lots }>();
  for (const l of lots) {
    const e = byProduct.get(l.product) ?? { product: l.product, unit: l.unit, qty: 0, lots: [] };
    e.qty += l.qty; e.lots.push(l); byProduct.set(l.product, e);
  }
  const items = [...byProduct.values()];
  const attention = lots.filter((l) => (l.expires_on && daysBetween(today, l.expires_on) <= 7) || (l.produced_on && daysBetween(l.produced_on, today) > 30));
  const total = items.reduce((s, i) => s + i.qty, 0);

  return (
    <>
      <PageHeader
        title="Congelator"
        description="Ce este în lada frigorifică, din ce lot, de când, și unde a plecat. Fiecare intrare și ieșire are dată, cantitate, produs și document."
        actions={<a href={`/api/export/stock?loc=${freezer.id}`} className="btn btn-ghost"><Download className="size-4" />Export Excel</a>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Unități în stoc" value={fmtNum(total)} hint={<span>{items.length} produse · {lots.length} loturi</span>} />
        <Kpi label="Necesită atenție" value={fmtNum(attention.length)} hint={<span>loturi vechi (&gt;30 zile) sau care expiră în 7 zile</span>} />
        <Kpi label="Expediat în 30 zile" value={fmtNum(shipped.reduce((s, x) => s + x.qty, 0))} hint={<span>către locații</span>} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Stoc pe produse și loturi" subtitle="Lotul cel mai vechi este primul de folosit (FIFO)" pad={false}>
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Produs</th><th>Lot</th><th>Produs la</th><th>Expiră</th><th className="num">Cantitate</th></tr></thead>
                <tbody>
                  {items.flatMap((it) => it.lots.map((l, i) => {
                    const age = l.produced_on ? daysBetween(l.produced_on, today) - 1 : null;
                    const toExp = l.expires_on ? daysBetween(today, l.expires_on) - 1 : null;
                    return (
                      <tr key={`${it.product}-${l.lot}-${l.produced_on}-${i}`}>
                        <td className="font-medium text-ink">{i === 0 ? <>{it.product}<div className="text-xs font-normal text-muted">total {fmtNum(it.qty)} {it.unit}</div></> : ""}</td>
                        <td className="text-xs">{l.lot ?? <span className="text-faint">fără lot</span>}{i === 0 && it.lots.length > 1 && <span className="ml-1.5"><Badge tone="accent">primul</Badge></span>}</td>
                        <td className="text-xs">{l.produced_on ? <>{fmtDate(l.produced_on)} {age !== null && age > 30 && <Badge tone="warn">{age} zile</Badge>}</> : "—"}</td>
                        <td className="text-xs">{l.expires_on ? <>{fmtDate(l.expires_on)} {toExp !== null && toExp <= 7 && <Badge tone="bad">{toExp < 0 ? "expirat" : `${toExp} zile`}</Badge>}</> : "—"}</td>
                        <td className="num">{fmtNum(l.qty)} <span className="text-muted">{l.unit}</span></td>
                      </tr>
                    );
                  }))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Snowflake className="size-5" />} title="Congelatorul este gol în evidență">
              Înregistrați intrările din producție (cu lot și dată) folosind formularul alăturat.
            </EmptyState>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Intrare / ieșire congelator">
            <MovementForm locations={all} products={products} defaultLocationId={freezer.id} defaultKind="production" showLots />
          </Card>
          <Card title="Alocat locațiilor (30 zile)">
            {shipped.length ? (
              <ul className="space-y-2 text-sm">
                {shipped.map((s) => (
                  <li key={s.location + s.product} className="flex justify-between gap-2"><span className="truncate text-ink-2">{s.location} · {s.product}</span><span className="tabular-nums">{fmtNum(s.qty)} {s.unit}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Niciun transfer în ultimele 30 de zile.</p>}
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Mișcări congelator" subtitle="Ultimele 30" pad={false}>
        {moves.length ? <MovementTable rows={moves} /> : <EmptyState title="Fără mișcări încă" />}
      </Card>
    </>
  );
}
