import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { canAccess, requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtNum, fmtRon, pctChange } from "@/lib/format";
import type { DailyReport, MonthlyReport } from "@/lib/reports";
import { Card, Delta, Kpi, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raport" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("dashboard");
  const r = await one<{ id: number; kind: "daily" | "monthly"; title: string; data: any; created_at: string }>(
    "SELECT id, kind, title, data, created_at FROM reports WHERE id=$1", [Number((await params).id)]);
  if (!r) notFound();
  // Managerii de locație văd doar locațiile lor.
  const sees = (id: number) => user.locationIds === null || user.locationIds.includes(id);

  return (
    <div className="mx-auto max-w-[960px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/rapoarte" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Rapoarte</Link>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{r.title}</h1>
          <p className="text-sm text-muted">Generat automat {fmtDateTime(r.created_at)}</p>
        </div>
        {r.kind === "monthly" && canAccess(user, "invoices") && (
          <a href={`/api/export/costs?m=${(r.data as MonthlyReport).month}`} className="btn btn-primary"><Download className="size-4" />Raport Costuri – Venituri</a>
        )}
      </div>
      {r.kind === "daily" ? <Daily d={r.data as DailyReport} sees={sees} /> : <Monthly d={r.data as MonthlyReport} sees={sees} />}
    </div>
  );
}

function Daily({ d, sees }: { d: DailyReport; sees: (id: number) => boolean }) {
  const locs = d.locations.filter((l) => sees(l.id));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {locs.map((l) => (
          <Kpi key={l.id} label={`${l.name} · ${fmtDate(d.date)}`} value={fmtRon(l.net)} delta={pctChange(l.net, l.prevWeek)} deltaSuffix="vs. aceeași zi săpt. trecută"
            hint={<span>{l.receipts} bonuri · media ultimelor 4 {fmtRon(l.avg4)}{!l.net && l.lastSale && ` · ultimele vânzări: ${l.lastSale}`}</span>} />
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card title="Cele mai vândute" pad={false}>
          <table className="table"><tbody>{d.top.map((t) => <tr key={t.name}><td className="font-medium text-ink">{t.name}</td><td className="num">{fmtNum(t.qty)}</td><td className="num">{fmtRon(t.net)}</td></tr>)}</tbody></table>
          {!d.top.length && <p className="p-5 text-sm text-muted">Nicio vânzare importată pentru această zi.</p>}
        </Card>
        <Card title="Ce urmează azi">
          <ul className="space-y-2 text-sm text-ink-2">
            <li>{d.ops.ordersDue} comenzi de livrat până azi · {d.ops.ordersToConfirm} de confirmat · {d.ops.inTransit} în tranzit</li>
            <li>{d.ops.productionToApprove} documente de producție de aprobat · {d.ops.invoicesDraft} facturi de verificat</li>
            {d.ops.proofing.map((p) => <li key={p.location}>Plan dospire {p.location}: <b className="text-ink">{p.status === "confirmed" ? "confirmat" : p.status === "draft" ? "ciornă" : "lipsă"}</b></li>)}
          </ul>
        </Card>
      </div>
      <Card title="Alerte active la generare">
        {d.alerts.length ? <ul className="space-y-1.5 text-sm">{d.alerts.map((a) => <li key={a.title}>{a.link ? <Link href={a.link} className="text-ink hover:text-crust">{a.title}</Link> : a.title}</li>)}</ul> : <p className="text-sm text-good">Nicio alertă activă.</p>}
      </Card>
    </>
  );
}

function Monthly({ d, sees }: { d: MonthlyReport; sees: (id: number) => boolean }) {
  const locs = d.locations.filter((l) => sees(l.id));
  return (
    <>
      <Card title="Locații" subtitle="Vânzări fără TVA din Publine · costuri înregistrate în aplicație" pad={false}>
        <table className="table">
          <thead><tr><th>Locație</th><th className="num">Vânzări</th><th className="num">vs. luna anterioară</th><th className="num">Costuri</th><th className="num">Materii prime</th><th className="num">Rezultat estimat</th></tr></thead>
          <tbody>
            {locs.map((l) => (
              <tr key={l.id}>
                <td className="font-medium text-ink">{l.name}</td>
                <td className="num">{fmtRon(l.revenue)}</td>
                <td className="num"><Delta value={pctChange(l.revenue, l.prevRevenue)} /></td>
                <td className="num">{fmtRon(l.costs)}</td>
                <td className="num text-muted">{fmtRon(l.materials)}</td>
                <td className={`num font-semibold ${l.revenue - l.costs < 0 ? "text-bad" : ""}`}>{fmtRon(l.revenue - l.costs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Notice tone="warn">Rezultatul estimat nu este profitul contabil: depinde de costurile introduse în aplicație și nu include variația stocurilor.</Notice>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card title="Top 10 produse" pad={false}>
          <table className="table"><tbody>{d.top.map((t) => <tr key={t.name}><td className="font-medium text-ink">{t.name}</td><td className="num">{fmtNum(t.qty)}</td><td className="num">{fmtRon(t.net)}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Activitate în lună">
          <ul className="space-y-2 text-sm text-ink-2">
            <li>{d.invoices.count} facturi verificate · {fmtRon(d.invoices.net)} fără TVA</li>
            <li>{d.production.orders} documente de producție aprobate · {fmtNum(d.production.qty)} bucăți</li>
            <li>{d.orders.received} comenzi recepționate · {fmtNum(d.orders.shortfall)} bucăți mai puțin decât comandat</li>
            <li>{d.inventory.counts} inventare închise · diferență netă {fmtRon(d.inventory.value, true)}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
