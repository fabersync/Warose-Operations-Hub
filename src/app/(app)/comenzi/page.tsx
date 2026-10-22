import Link from "next/link";
import { ClipboardList, Plus, Truck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { listOrders, STATUS } from "@/lib/orders";
import { Badge, Card, EmptyState, Kpi, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comenzi & transferuri" };

const FILTERS = [
  { v: "open", l: "Active" },
  { v: "draft", l: "Ciorne" },
  { v: "received", l: "Recepționate" },
  { v: "cancelled", l: "Anulate" },
  { v: "all", l: "Toate" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const user = await requireUser("orders");
  const s = (await searchParams).s ?? "open";
  const [orders, all] = await Promise.all([listOrders(user, s), listOrders(user, "open")]);
  const count = (st: string) => all.filter((o) => o.status === st).length;
  const canCreate = ["admin", "location_manager"].includes(user.role);

  return (
    <>
      <PageHeader
        title="Comenzi & transferuri"
        description="Comenzile locațiilor către BRUTĂRIE și depozitul de congelate, de la trimitere la recepție. Cantitățile comandate, confirmate, expediate și recepționate rămân separate, cu istoric complet."
        actions={<>
          {["admin", "production"].includes(user.role) && <Link href="/comenzi/necesar" className="btn btn-ghost"><ClipboardList className="size-4" />Necesar comenzi</Link>}
          {canCreate && <Link href="/comenzi/nou" className="btn btn-primary"><Plus className="size-4" />Comandă nouă</Link>}
        </>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="De confirmat" value={fmtNum(count("submitted"))} hint={<span>trimise de locații</span>} />
        <Kpi label="De pregătit" value={fmtNum(count("confirmed") + count("preparing"))} hint={<span>confirmate sau în pregătire</span>} />
        <Kpi label="În tranzit" value={fmtNum(count("shipped"))} hint={<span>expediate, nerecepționate</span>} />
        <Kpi label="Următoarea livrare" value={all.length ? fmtDate(all.filter((o) => o.status !== "shipped")[0]?.needed_for ?? all[0].needed_for) : "—"} hint={<span>după data de necesar</span>} />
      </div>

      <div className="mb-4 mt-6 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.v} href={`/comenzi?s=${f.v}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${s === f.v ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{f.l}</Link>
        ))}
      </div>

      <Card pad={false}>
        {orders.length ? (
          <table className="table">
            <thead><tr><th>#</th><th>De la → către</th><th>Necesar pentru</th><th className="num">Produse</th><th className="num">Comandat</th><th className="num">Expediat</th><th className="num">Recepționat</th><th>Stare</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/comenzi/${o.id}`} className="font-medium text-crust hover:text-crust-strong">#{o.id}</Link></td>
                  <td><div className="font-medium text-ink">{o.from_name}</div><div className="text-xs text-muted">din {o.to_name} · {o.author}, {fmtDateTime(o.created_at)}</div></td>
                  <td className="whitespace-nowrap">{fmtDate(o.needed_for)}</td>
                  <td className="num">{o.lines}</td>
                  <td className="num">{fmtNum(o.ordered)}</td>
                  <td className="num">{o.shipped != null ? fmtNum(o.shipped) : "—"}</td>
                  <td className="num">{o.received != null ? <span className={o.shipped != null && o.received < o.shipped ? "text-bad" : ""}>{fmtNum(o.received)}</span> : "—"}</td>
                  <td><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Truck className="size-5" />} title="Nicio comandă în această listă"
            action={canCreate ? <Link href="/comenzi/nou" className="btn btn-primary">Creează o comandă</Link> : undefined}>
            Comenzile pentru produse congelate se trimit din aplicație, în locul formularelor pe hârtie.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
