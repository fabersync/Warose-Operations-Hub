import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { addDays, fmtDate, fmtNum, todayLocal } from "@/lib/format";
import { openDemand } from "@/lib/orders";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ShortagePlanForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Necesar comenzi" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("orders");
  if (!["admin", "production"].includes(user.role)) redirect("/comenzi");
  const sp = await searchParams;
  const today = todayLocal();
  const from = isDate(sp.from) ? sp.from! : today;
  const to = isDate(sp.to) ? sp.to! : addDays(today, 7);
  const rows = await openDemand(user, from, to);
  const bySupplier = new Map<number, { name: string; rows: typeof rows }>();
  for (const r of rows) {
    const e = bySupplier.get(r.to_location_id) ?? { name: r.to_name, rows: [] };
    e.rows.push(r);
    bySupplier.set(r.to_location_id, e);
  }

  return (
    <>
      <PageHeader
        title="Necesar din comenzi"
        description="Totalul cerut de locații în comenzile active (trimise, confirmate, în pregătire), comparat cu stocul furnizorului. Lipsurile pot fi transformate direct în plan de producție."
        actions={<Link href="/comenzi" className="btn btn-ghost"><ArrowLeft className="size-4" />Comenzi</Link>}
      />
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="field"><label className="label" htmlFor="from">Necesar de la</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div className="field"><label className="label" htmlFor="to">până la</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <button className="btn btn-primary">Aplică</button>
      </form>

      {bySupplier.size === 0 ? (
        <Card><EmptyState title="Nicio comandă activă în perioadă">Comenzile trimise de locații pentru {fmtDate(from)} – {fmtDate(to)} vor apărea aici.</EmptyState></Card>
      ) : [...bySupplier.entries()].map(([id, s]) => {
        const shortages = s.rows.filter((r) => r.demand > r.stock + 1e-9).map((r) => ({ product_id: r.product_id, product: r.product, unit: r.unit, qty: r.demand - Math.max(r.stock, 0) }));
        return (
          <div key={id} className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title={s.name} subtitle={`${s.rows.length} produse cerute`} pad={false}>
              <table className="table">
                <thead><tr><th>Produs</th><th className="num">Comenzi</th><th className="num">Cerut</th><th className="num">În stoc</th><th className="num">Diferență</th></tr></thead>
                <tbody>
                  {s.rows.map((r) => {
                    const d = r.stock - r.demand;
                    return (
                      <tr key={r.product_id}>
                        <td className="font-medium text-ink">{r.product}</td>
                        <td className="num">{r.orders}</td>
                        <td className="num">{fmtNum(r.demand)} <span className="text-muted">{r.unit}</span></td>
                        <td className="num">{fmtNum(r.stock)}</td>
                        <td className="num">{d < -1e-9 ? <Badge tone="bad">lipsă {fmtNum(-d)}</Badge> : <Badge tone="good">acoperit</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <Card title="Lipsuri" subtitle={shortages.length ? "Planificați producția pentru acoperire" : undefined}>
              {shortages.length ? (
                <ShortagePlanForm freezerId={s.rows[0].to_kind === "freezer" ? id : null} defaultDate={today} rows={shortages} />
              ) : <Notice tone="good">Stocul acoperă toate comenzile active.</Notice>}
            </Card>
          </div>
        );
      })}
    </>
  );
}
