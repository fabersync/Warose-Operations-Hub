import Link from "next/link";
import { ArrowLeft, ClipboardList, Download, Plus, SlidersHorizontal } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtNum, fmtRon } from "@/lib/format";
import { canPurchase, locationSuppliers, needs, purchasingLocations, type NeedRow } from "@/lib/purchasing";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Necesar comenzi" };

const HORIZONS = [1, 2, 3, 7, 14];

/**
 * Necesarul de comandat pe locație (sau pentru toate), grupat pe furnizor: ce e sub stocul minim
 * și ce trebuie pentru producția planificată. Din fiecare grup se creează comanda cu un clic.
 */
export default async function NeedsPage({ searchParams }: { searchParams: Promise<{ loc?: string; days?: string }> }) {
  const user = await requireUser("purchasing");
  const sp = await searchParams;
  const locations = await purchasingLocations(user);
  const all = sp.loc === "all";
  const loc = locations.find((l) => l.id === Number(sp.loc)) ?? (all ? null : locations[0]);
  const days = HORIZONS.includes(Number(sp.days)) ? Number(sp.days) : 3;
  const ids = all ? locations.map((l) => l.id) : loc ? [loc.id] : [];
  const [rows, sup] = await Promise.all([needs(ids, days), locationSuppliers(ids)]);

  // Grupare: locație → furnizor.
  const byLoc = new Map<number, { name: string; groups: Map<string, NeedRow[]> }>();
  for (const r of rows) {
    const L = byLoc.get(r.location_id) ?? { name: r.location, groups: new Map() };
    const k = r.supplier_id ? String(r.supplier_id) : "-";
    L.groups.set(k, [...(L.groups.get(k) ?? []), r]);
    byLoc.set(r.location_id, L);
  }
  const total = rows.reduce((s, r) => s + r.suggested * (r.last_price ?? 0), 0);
  const href = (o: Record<string, string>) => `/aprovizionare/necesar?${new URLSearchParams({ loc: all ? "all" : String(loc?.id ?? ""), days: String(days), ...o })}`;

  return (
    <>
      <PageHeader title="Necesar comenzi"
        description="Ce trebuie comandat, exact: produsele sub stocul minim (până la nivelul țintă) și materiile prime pentru producția planificată, grupate pe furnizor. Verificați cantitățile, apoi creați comanda pentru fiecare furnizor."
        actions={<>
          <a href={`/api/export/necesar?${new URLSearchParams({ loc: all ? "all" : String(loc?.id ?? ""), days: String(days) })}`} className="btn btn-ghost"><Download className="size-4" />Excel</a>
          <Link href="/aprovizionare" className="btn btn-ghost"><ArrowLeft className="size-4" />Comenzi furnizori</Link>
        </>} />

      <div className="card mb-4 flex flex-wrap items-center gap-1.5 p-3">
        {locations.map((l) => (
          <Link key={l.id} href={href({ loc: String(l.id) })} className={`rounded-md px-3 py-1.5 text-xs font-medium ${!all && l.id === loc?.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</Link>
        ))}
        {locations.length > 1 && <Link href={href({ loc: "all" })} className={`rounded-md px-3 py-1.5 text-xs font-medium ${all ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>Toate locațiile</Link>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">Producție planificată în următoarele
          {HORIZONS.map((d) => <Link key={d} href={href({ days: String(d) })} className={`rounded-md px-2 py-1 font-medium ${d === days ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"}`}>{d}</Link>)} zile
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div className="card card-pad"><div className="eyebrow">Produse de comandat</div><div className="mt-2 text-[26px] font-semibold tabular-nums">{rows.length}</div></div>
          <div className="card card-pad"><div className="eyebrow">Furnizori</div><div className="mt-2 text-[26px] font-semibold tabular-nums">{new Set(rows.map((r) => `${r.location_id}-${r.supplier_id}`)).size}</div></div>
          <div className="card card-pad"><div className="eyebrow">Valoare estimată (fără TVA)</div><div className="mt-2 text-[26px] font-semibold tabular-nums">{fmtRon(total)}</div></div>
        </div>
      )}

      {byLoc.size ? (
        <div className="space-y-6">
          {[...byLoc.entries()].map(([locId, L]) => (
            <section key={locId}>
              {(all || byLoc.size > 1) && <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{L.name}</h2>}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                {[...L.groups.entries()].map(([k, items]) => {
                  const est = items.reduce((s, r) => s + r.suggested * (r.last_price ?? 0), 0);
                  return (
                    <Card key={k} title={items[0].supplier ?? "Fără furnizor stabilit"}
                      subtitle={<>{items.length} produse · estimat {fmtRon(est)}{items[0].supplier_id && !items[0].preferred ? " · nu e în lista furnizorilor locației" : ""}</>}
                      action={canPurchase(user, locId) ? (
                        <Link href={`/aprovizionare/nou?loc=${locId}&from=suggest&days=${days}${items[0].supplier_id ? `&supplier=${items[0].supplier_id}` : ""}`} className="btn btn-primary py-1.5 text-xs"><Plus className="size-3.5" />Creează comanda</Link>
                      ) : undefined} pad={false}>
                      <table className="table">
                        <thead><tr><th>Produs</th><th className="num">Stoc</th><th className="num">Minim / țintă</th><th className="num">Pt. producție</th><th className="num">De comandat</th></tr></thead>
                        <tbody>
                          {items.map((r) => (
                            <tr key={r.product_id}>
                              <td className="font-medium text-ink">{r.product}</td>
                              <td className={`num ${r.stock < (r.min_qty ?? 0) ? "text-bad" : ""}`}>{fmtNum(r.stock)}</td>
                              <td className="num text-muted">{r.min_qty != null ? `${fmtNum(r.min_qty)} / ${fmtNum(r.target_qty)}` : "—"}</td>
                              <td className="num">{r.production_need ? fmtNum(r.production_need) : "—"}</td>
                              <td className="num"><b>{fmtNum(r.suggested)}</b> {r.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<ClipboardList className="size-5" />} title="Nimic de comandat acum"
            action={loc ? <Link href={`/aprovizionare/stocuri-minime?loc=${loc.id}`} className="btn btn-ghost"><SlidersHorizontal className="size-4" />Stocuri minime și furnizori</Link> : undefined}>
            Nu există produse sub stocul minim și nici producție planificată care să ceară materii prime. Setați stocurile minime ale locației ca aplicația să calculeze necesarul.
          </EmptyState>
        </Card>
      )}

      {sup.length > 0 && (
        <div className="mt-6 text-xs text-muted">
          Furnizorii locației{all ? "lor" : ""}: {[...new Map(sup.map((s) => [s.supplier_id, s])).values()].map((s) => <Badge key={s.supplier_id}>{s.name}</Badge>).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, " ", b] : [b]), [])}
        </div>
      )}
    </>
  );
}
