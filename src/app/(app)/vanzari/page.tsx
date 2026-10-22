import { Download, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { addDays, daysBetween, fmtDate, fmtNum, fmtRon, monthStart, pctChange } from "@/lib/format";
import { lastSaleTimestamp, locationsFor, paymentMix, productPerformance, salesByDay, salesByLocation, salesTotals } from "@/lib/queries";
import { Card, Delta, EmptyState, Kpi, PageHeader } from "@/components/ui";
import { DailyBars } from "@/components/Charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vânzări" };

type SP = { from?: string; to?: string; loc?: string; q?: string; preset?: string };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("sales");
  const sp = await searchParams;
  const last = await lastSaleTimestamp(user);
  const ref = last.d ?? new Date().toISOString().slice(0, 10);

  let from = isDate(sp.from) ? sp.from! : monthStart(ref);
  let to = isDate(sp.to) ? sp.to! : ref;
  if (from > to) [from, to] = [to, from];
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const locationId = sp.loc ? Number(sp.loc) : null;
  const search = sp.q?.trim() || null;
  const f = { from, to, locationId, search };
  const pf = { from: prevFrom, to: prevTo, locationId, search };

  const [locations, totals, prevTotals, days, byLoc, perf, mix] = await Promise.all([
    locationsFor(user, ["store"]),
    salesTotals(user, f),
    salesTotals(user, pf),
    salesByDay(user, f),
    salesByLocation(user, f, pf),
    productPerformance(user, f, pf),
    paymentMix(user, f),
  ]);

  const ranked = [...perf].filter((p) => p.net > 0 || p.prev_net > 0).sort((a, b) => b.net - a.net);
  const growing = perf.filter((p) => p.prev_net >= 100).map((p) => ({ ...p, ch: pctChange(p.net, p.prev_net)! })).filter((p) => p.ch > 10).sort((a, b) => b.ch - a.ch).slice(0, 8);
  const falling = perf.filter((p) => p.prev_net >= 100).map((p) => ({ ...p, ch: pctChange(p.net, p.prev_net)! })).filter((p) => p.ch < -10).sort((a, b) => a.ch - b.ch).slice(0, 8);
  const weak = [...perf].filter((p) => p.net > 0 && p.qty > 0).sort((a, b) => a.net - b.net).slice(0, 8);
  const mixTotal = mix.reduce((s, m) => s + m.gross, 0) || 1;
  const exportHref = `/api/export/sales?${new URLSearchParams({ from, to, ...(locationId ? { loc: String(locationId) } : {}), ...(search ? { q: search } : {}) })}`;

  const presets = [
    { label: "Luna curentă", from: monthStart(ref), to: ref },
    { label: "Luna trecută", from: monthStart(addDays(monthStart(ref), -1)), to: addDays(monthStart(ref), -1) },
    { label: "Ultimele 7 zile", from: addDays(ref, -6), to: ref },
    { label: "Ultimele 30 zile", from: addDays(ref, -29), to: ref },
  ];

  return (
    <>
      <PageHeader
        title="Vânzări"
        description={<>Date din Publine, fără TVA. Perioada este comparată automat cu perioada precedentă de aceeași lungime ({fmtDate(prevFrom)} – {fmtDate(prevTo)}).</>}
        actions={<a href={exportHref} className="btn btn-ghost"><Download className="size-4" />Export Excel</a>}
      />

      <form className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <div className="field"><label className="label" htmlFor="from">De la</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div className="field"><label className="label" htmlFor="to">Până la</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <div className="field">
          <label className="label" htmlFor="loc">Locație</label>
          <select id="loc" name="loc" defaultValue={locationId ?? ""} className="input">
            <option value="">Toate locațiile</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="q">Produs</label><input id="q" name="q" defaultValue={search ?? ""} placeholder="ex: covrig" className="input" /></div>
        <button className="btn btn-primary">Aplică</button>
        <div className="flex flex-wrap gap-1.5 sm:col-span-2 lg:col-span-5">
          {presets.map((p) => {
            const active = p.from === from && p.to === to;
            const qs = new URLSearchParams({ from: p.from, to: p.to, ...(locationId ? { loc: String(locationId) } : {}), ...(search ? { q: search } : {}) });
            return <a key={p.label} href={`?${qs}`} className={`rounded-md px-2.5 py-1 text-xs font-medium ${active ? "bg-ink text-white" : "bg-canvas text-ink-2 hover:bg-line"}`}>{p.label}</a>;
          })}
        </div>
      </form>

      {totals.lines === 0 && prevTotals.lines === 0 ? (
        <Card><EmptyState icon={<TrendingUp className="size-5" />} title="Nicio vânzare în perioada aleasă">Alegeți altă perioadă sau verificați importurile.</EmptyState></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Vânzări nete" value={fmtRon(totals.net)} delta={pctChange(totals.net, prevTotals.net)} hint={<span>{fmtRon(totals.gross)} cu TVA</span>} />
            <Kpi label="Bonuri" value={fmtNum(totals.receipts)} delta={pctChange(totals.receipts, prevTotals.receipts)} />
            <Kpi label="Bon mediu (net)" value={fmtRon(totals.receipts ? totals.net / totals.receipts : 0, true)} delta={pctChange(totals.receipts ? totals.net / totals.receipts : 0, prevTotals.receipts ? prevTotals.net / prevTotals.receipts : 0)} />
            <Kpi label="Medie zilnică (net)" value={fmtRon(totals.net / len)} delta={pctChange(totals.net / len, prevTotals.net / len)} hint={<span>{len} zile</span>} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Vânzări nete pe zile"><DailyBars data={days} /></Card>
            <Card title="Pe locații și metode de plată">
              <ul className="space-y-3 text-sm">
                {byLoc.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{l.name}</span>
                    <span className="flex items-center gap-2 tabular-nums">{fmtRon(l.net)} <Delta value={pctChange(l.net, l.prevNet)} /></span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 border-t border-line pt-4">
                <div className="eyebrow mb-3">Încasări (cu TVA)</div>
                <ul className="space-y-2.5">
                  {mix.map((m) => (
                    <li key={m.method}>
                      <div className="flex justify-between text-xs"><span className="text-ink-2">{m.method}</span><span className="tabular-nums text-muted">{fmtRon(m.gross)} · {Math.round((m.gross / mixTotal) * 100)}%</span></div>
                      <div className="mt-1 h-1 rounded-full bg-canvas"><div className="h-full rounded-full bg-ink" style={{ width: `${(m.gross / mixTotal) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <MiniList title="În creștere" subtitle="Peste +10% față de perioada precedentă" rows={growing.map((p) => ({ name: p.name, value: fmtRon(p.net), ch: p.ch }))} empty="Niciun produs în creștere semnificativă" />
            <MiniList title="În scădere" subtitle="Sub −10% față de perioada precedentă" rows={falling.map((p) => ({ name: p.name, value: fmtRon(p.net), ch: p.ch }))} empty="Niciun produs în scădere semnificativă" />
            <MiniList title="Vânzări slabe" subtitle="Cele mai mici valori din perioadă" rows={weak.map((p) => ({ name: p.name, value: `${fmtNum(p.qty)} buc · ${fmtRon(p.net)}`, ch: pctChange(p.net, p.prev_net) }))} empty="—" />
          </div>

          <Card className="mt-4" title="Clasament produse" subtitle={`${ranked.length} produse · sortat după valoare netă`} pad={false}>
            <div className="max-h-[560px] overflow-auto">
              <table className="table">
                <thead className="sticky top-0 bg-surface"><tr><th>#</th><th>Produs</th><th className="num">Cantitate</th><th className="num">Valoare netă</th><th className="num">Pondere</th><th className="num">Perioada prec.</th><th className="num">Evoluție</th></tr></thead>
                <tbody>
                  {ranked.map((p, i) => (
                    <tr key={p.name}>
                      <td className="text-muted tabular-nums">{i + 1}</td>
                      <td className="font-medium text-ink">{p.name}</td>
                      <td className="num">{fmtNum(p.qty)}</td>
                      <td className="num">{fmtRon(p.net, true)}</td>
                      <td className="num text-muted">{totals.net ? ((p.net / totals.net) * 100).toFixed(1) : "0"}%</td>
                      <td className="num text-muted">{fmtRon(p.prev_net)}</td>
                      <td className="num"><Delta value={pctChange(p.net, p.prev_net)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function MiniList({ title, subtitle, rows, empty }: { title: string; subtitle: string; rows: { name: string; value: string; ch: number | null }[]; empty: string }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length ? (
        <ul className="space-y-2.5 text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-ink-2" title={r.name}>{r.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted">{r.value} <Delta value={r.ch} /></span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{empty}</p>}
    </Card>
  );
}
