import Link from "next/link";
import { AlertTriangle, CalendarRange, CheckCircle2, Download, RefreshCw, Snowflake, UploadCloud } from "lucide-react";
import { requireUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { addDays, daysBetween, fmtDate, fmtLocalTs, fmtNum, fmtPct, fmtRon, monthStart, pctChange, relativeTime, todayLocal } from "@/lib/format";
import { lastSaleTimestamp, locationsFor, paymentMix, productPerformance, salesByDay, salesByLocation, salesTotals, stockLevels, syncStatus } from "@/lib/queries";
import { costsByCategory, internalTotals, salesByCategory, salesByHour, salesByWeekday, scopeIds, topSuppliers } from "@/lib/overview";
import { Badge, Card, Delta, EmptyState, Kpi, Notice, PageHeader, TextLink } from "@/components/ui";
import { Donut, HourBars, SalesTrend, Sparkline } from "@/components/Charts";

export const dynamic = "force-dynamic";

type SP = { denied?: string; from?: string; to?: string; loc?: string };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const WEEKDAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (!canAccess(user, "dashboard")) {
    return <PageHeader title={`Bună, ${user.name}`} description="Folosiți meniul pentru operațiunile la care aveți acces." />;
  }

  const last = await lastSaleTimestamp(user);
  const today = todayLocal();
  // Implicit: luna ultimelor vânzări importate, până în ziua lor.
  const ref = last.d ?? today;
  let from = isDate(sp.from) ? sp.from! : monthStart(ref);
  let to = isDate(sp.to) ? sp.to! : ref;
  if (from > to) [from, to] = [to, from];
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const locations = await locationsFor(user, ["store"]);
  const locationId = locations.some((l) => l.id === Number(sp.loc)) ? Number(sp.loc) : null;
  const f = { from, to, locationId };
  const pf = { from: prevFrom, to: prevTo, locationId };
  const ids = scopeIds(user, locationId);
  const showCosts = canAccess(user, "invoices") || canAccess(user, "profitability");

  const [cur, prev, trend, byLoc, perf, hours, weekdays, cats, mix, internal, prevInternal, costs, suppliers, freezer, stock, sync] = await Promise.all([
    salesTotals(user, f), salesTotals(user, pf),
    salesByDay(user, f),
    salesByLocation(user, f, pf),
    productPerformance(user, f, pf),
    salesByHour(user, f), salesByWeekday(user, f), salesByCategory(user, f), paymentMix(user, f),
    internalTotals({ from, to, locationIds: ids }), internalTotals({ from: prevFrom, to: prevTo, locationIds: ids }),
    showCosts ? costsByCategory({ from, to, locationIds: ids }) : Promise.resolve([]),
    showCosts ? topSuppliers({ from, to, locationIds: ids }) : Promise.resolve([]),
    stockLevels(user, { frozenOnly: true }),
    stockLevels(user),
    syncStatus(),
  ]);

  const invParams: unknown[] = [];
  const invScope = user.locationIds === null ? "TRUE" : (invParams.push(user.locationIds), "location_id = ANY($1::int[])");
  const [inv] = await q<{ open: number; last_value: number | null; last_loc: string | null; drafts: number }>(
    `SELECT (SELECT count(*)::int FROM inventory_counts WHERE status = 'open' AND ${invScope}) open,
            (SELECT posted_value::float8 FROM inventory_counts WHERE status = 'closed' AND ${invScope} ORDER BY closed_at DESC LIMIT 1) last_value,
            (SELECT count(*)::int FROM invoices WHERE status = 'draft') drafts,
            (SELECT l.name FROM inventory_counts c JOIN locations l ON l.id = c.location_id WHERE c.status = 'closed' AND ${invScope.replace("location_id", "c.location_id")} ORDER BY c.closed_at DESC LIMIT 1) last_loc`,
    invParams,
  );
  const tomorrow = addDays(today, 1);
  const proofStores = await q<{ name: string; status: string | null }>(
    `SELECT l.name, p.status FROM locations l
       LEFT JOIN proofing_plans p ON p.location_id = l.id AND p.plan_date = $1 AND p.status <> 'cancelled'
      WHERE l.kind = 'store' AND l.active${user.locationIds === null ? "" : " AND l.id = ANY($2::int[])"}`,
    user.locationIds === null ? [tomorrow] : [tomorrow, user.locationIds],
  );
  const unconfirmed = proofStores.filter((s) => s.status !== "confirmed");
  const ordScope = user.locationIds === null ? "TRUE" : "(to_location_id = ANY($1::int[]) OR from_location_id = ANY($1::int[]))";
  const [ord] = await q<{ to_confirm: number; to_prepare: number; in_transit: number }>(
    `SELECT count(*) FILTER (WHERE status = 'submitted')::int to_confirm,
            count(*) FILTER (WHERE status IN ('confirmed', 'preparing'))::int to_prepare,
            count(*) FILTER (WHERE status = 'shipped')::int in_transit
       FROM location_orders WHERE ${ordScope}`,
    user.locationIds === null ? [] : [user.locationIds],
  );

  const salesDays = trend.filter((d) => d.net > 0).length;
  const perDay = salesDays ? cur.net / salesDays : 0;
  const prevDays = Math.max(1, len);
  const avgTicket = cur.receipts ? cur.net / cur.receipts : 0;
  const prevAvgTicket = prev.receipts ? prev.net / prev.receipts : 0;
  const top = [...perf].sort((a, b) => b.net - a.net).slice(0, 8);
  const topQty = [...perf].sort((a, b) => b.qty - a.qty).slice(0, 8);
  const declining = perf.filter((p) => p.prev_net >= 150).map((p) => ({ ...p, change: pctChange(p.net, p.prev_net)! }))
    .filter((p) => p.change < -10).sort((a, b) => a.change - b.change).slice(0, 6);
  const growing = perf.filter((p) => p.prev_net >= 150).map((p) => ({ ...p, change: pctChange(p.net, p.prev_net)! }))
    .filter((p) => p.change > 10).sort((a, b) => b.change - a.change).slice(0, 6);
  const best = trend.reduce<{ day: string; net: number } | null>((b, d) => (!b || d.net > b.net ? d : b), null);
  const peakHour = hours.reduce<{ hour: number; net: number } | null>((b, h) => (!b || h.net > b.net ? h : b), null);
  const costTotal = costs.reduce((s, c) => s + c.amount, 0);
  const internalCost = internal.loss.cost + internal.staff.cost + internal.protocol.cost;
  const result = cur.net - costTotal - internalCost;
  const negative = stock.filter((s) => s.qty < 0);
  const staleDays = last.d ? daysBetween(last.d, today) - 1 : null;
  const freezerUnits = freezer.reduce((s, x) => s + x.qty, 0);
  const locName = locationId ? locations.find((l) => l.id === locationId)?.name : "Toate locațiile";
  const qs = (o: Record<string, string>) => `/?${new URLSearchParams({ ...o, ...(locationId ? { loc: String(locationId) } : {}) })}`;
  const exportHref = `/api/export/complet?${new URLSearchParams({ from, to, ...(locationId ? { loc: String(locationId) } : {}) })}`;
  const presets = [
    { label: "Ultima zi", from: ref, to: ref },
    { label: "7 zile", from: addDays(ref, -6), to: ref },
    { label: "30 zile", from: addDays(ref, -29), to: ref },
    { label: "Luna curentă", from: monthStart(ref), to: ref },
    { label: "Luna trecută", from: monthStart(addDays(monthStart(ref), -1)), to: addDays(monthStart(ref), -1) },
    { label: "Anul curent", from: `${ref.slice(0, 4)}-01-01`, to: ref },
  ];
  const wdMax = Math.max(...weekdays.map((w) => (w.days ? w.net / w.days : 0)), 1);

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" }).format(new Date())}
        title={`Bună, ${user.name.split(" ")[0]}`}
        description="Imaginea de ansamblu a operațiunilor, pe perioada și locația alese. Toate cifrele provin din date importate și reconciliate."
        actions={<>
          {canAccess(user, "exports") && <a href={exportHref} className="btn btn-primary"><Download className="size-4" />Export Excel complet</a>}
          {canAccess(user, "imports") && <Link href="/importuri" className="btn btn-ghost"><UploadCloud className="size-4" />Importuri</Link>}
        </>}
      />

      {sp.denied && <div className="mb-5"><Notice tone="warn">Nu aveți acces la modulul solicitat.</Notice></div>}

      {/* Filtre: perioadă și locație */}
      <form className="card mb-5 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange className="mr-1 size-4 text-muted" />
          {presets.map((p) => {
            const on = p.from === from && p.to === to;
            return <Link key={p.label} href={qs({ from: p.from, to: p.to })} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${on ? "bg-ink text-white" : "bg-canvas text-ink-2 hover:bg-line"}`}>{p.label}</Link>;
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <div className="field"><label className="label" htmlFor="d_from">De la</label><input id="d_from" name="from" type="date" defaultValue={from} className="input" /></div>
          <div className="field"><label className="label" htmlFor="d_to">Până la</label><input id="d_to" name="to" type="date" defaultValue={to} className="input" /></div>
          <div className="field"><label className="label" htmlFor="d_loc">Locație</label>
            <select id="d_loc" name="loc" defaultValue={locationId ?? ""} className="input">
              <option value="">Toate locațiile</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></div>
          <button className="btn btn-ghost">Arată</button>
        </div>
      </form>

      {!last.d ? (
        <Card>
          <EmptyState icon={<UploadCloud className="size-5" />} title="Nu există încă vânzări importate"
            action={canAccess(user, "imports") ? <Link href="/importuri" className="btn btn-primary">Importă primul export Publine</Link> : undefined}>
            Instalați agentul de sincronizare pe calculatorul cu Publine sau încărcați manual un export „Situație comenzi”.
          </EmptyState>
        </Card>
      ) : (
        <>
          {staleDays !== null && staleDays > 1 && (
            <div className="mb-5">
              <Notice tone="warn" title={`Ultimele vânzări importate sunt din ${fmtDate(last.d)} (${staleDays} zile în urmă)`}>
                Verificați agentul de sincronizare din locație sau exportul Publine.
              </Notice>
            </div>
          )}

          {/* Cardul principal */}
          <section className="relative overflow-hidden rounded-2xl bg-[radial-gradient(120%_140%_at_0%_0%,#3a2a1c_0%,#1d1b18_55%,#141210_100%)] p-6 text-white shadow-[0_20px_50px_-20px_rgba(29,27,24,0.55)] sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#e9c79f]/10 blur-3xl" />
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#e9c79f]">{locName} · {fmtDate(from)} – {fmtDate(to)}</div>
                <div className="mt-3 text-[13px] text-white/60">Vânzări nete (fără TVA)</div>
                <div className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums">{fmtRon(cur.net)}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <HeroDelta value={pctChange(cur.net, prev.net)} />
                  <span className="text-white/50">vs. {fmtDate(prevFrom)} – {fmtDate(prevTo)} ({fmtRon(prev.net)})</span>
                </div>
              </div>
              <div className="h-24"><Sparkline data={trend.map((d) => d.net)} height={96} /></div>
            </div>
            <div className="relative mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 sm:grid-cols-3 2xl:grid-cols-6">
              <HeroStat label="Cu TVA" value={fmtRon(cur.gross)} />
              <HeroStat label="Bonuri" value={fmtNum(cur.receipts)} delta={pctChange(cur.receipts, prev.receipts)} />
              <HeroStat label="Bon mediu" value={fmtRon(avgTicket, true)} delta={pctChange(avgTicket, prevAvgTicket)} />
              <HeroStat label="Medie / zi" value={fmtRon(perDay)} delta={pctChange(perDay, prev.net / prevDays)} />
              <HeroStat label="Cea mai bună zi" value={best && best.net > 0 ? fmtDate(best.day).slice(0, 6) : "—"} sub={best && best.net > 0 ? fmtRon(best.net) : undefined} />
              <HeroStat label="Ora de vârf" value={peakHour && peakHour.net > 0 ? `${peakHour.hour}:00` : "—"} sub={peakHour && peakHour.net > 0 ? fmtRon(peakHour.net) : undefined} />
            </div>
          </section>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Pierderi (la cost)" value={fmtRon(internal.loss.cost, true)} delta={pctChange(internal.loss.cost, prevInternal.loss.cost)} deltaSuffix="vs. perioada anterioară"
              hint={<Link href="/pierderi" className="hover:text-ink">{cur.net ? `${fmtPct((internal.loss.cost / cur.net) * 100).replace("+", "")} din vânzări` : "Detalii"} →</Link>} />
            <Kpi label="Consum personal + protocol" value={fmtRon(internal.staff.cost + internal.protocol.cost, true)}
              hint={<Link href="/consum" className="hover:text-ink">personal {fmtRon(internal.staff.cost)} · protocol {fmtRon(internal.protocol.cost)} →</Link>} />
            {showCosts ? <>
              <Kpi label="Costuri facturi (fără TVA)" value={fmtRon(costTotal)} hint={<Link href="/facturi/costuri" className="hover:text-ink">{costs.length} categorii →</Link>} />
              <Kpi label="Rezultat estimat" value={<span className={result < 0 ? "text-bad" : ""}>{fmtRon(result)}</span>}
                hint={<span>vânzări − facturi − pierderi − consum{cur.net ? ` · marjă ${fmtPct((result / cur.net) * 100).replace("+", "")}` : ""}</span>} />
            </> : <>
              <Kpi label="Zile cu vânzări" value={fmtNum(salesDays)} hint={<span>din {len} zile alese</span>} />
              <Kpi label="Produse vândute" value={fmtNum(cur.qty)} delta={pctChange(cur.qty, prev.qty)} deltaSuffix="vs. perioada anterioară" />
            </>}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Evoluția vânzărilor nete" subtitle="Pe zile, fără TVA" action={<TextLink href={`/vanzari?from=${from}&to=${to}${locationId ? `&loc=${locationId}` : ""}`}>Analiză detaliată →</TextLink>}>
              <SalesTrend data={trend} />
            </Card>
            <Card title="Performanța locațiilor" subtitle="Față de perioada anterioară de aceeași lungime">
              <ul className="space-y-4">
                {byLoc.map((l) => {
                  const max = Math.max(...byLoc.map((x) => x.net), 1);
                  return (
                    <li key={l.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{l.name}</span>
                        <span className="text-sm tabular-nums text-ink">{fmtRon(l.net)}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#c08a52] to-crust" style={{ width: `${(l.net / max) * 100}%` }} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                        <span>{fmtNum(l.receipts)} bonuri · bon mediu {fmtRon(l.receipts ? l.net / l.receipts : 0, true)}</span>
                        <Delta value={pctChange(l.net, l.prevNet)} />
                      </div>
                    </li>
                  );
                })}
                {byLoc.length === 0 && <li className="text-sm text-muted">Fără vânzări în perioada aleasă.</li>}
              </ul>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Vânzări pe ore" subtitle="Unde e vârful zilei; ajută la planul de dospire și la program">
              <HourBars data={hours} />
            </Card>
            <Card title="Pe zilele săptămânii" subtitle="Media vânzărilor nete pe zi">
              <ul className="space-y-2.5">
                {WEEKDAYS.map((name, i) => {
                  const w = weekdays.find((x) => x.dow === i + 1);
                  const avg = w && w.days ? w.net / w.days : 0;
                  return (
                    <li key={name} className="grid grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-2 text-xs">
                      <span className="text-ink-2">{name}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-ink/80" style={{ width: `${(avg / wdMax) * 100}%` }} /></div>
                      <span className="text-right tabular-nums text-ink">{avg ? fmtRon(avg) : "—"}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
            <Card title="Cele mai vândute produse" subtitle="După valoare netă" pad={false}>
              <table className="table">
                <thead><tr><th>#</th><th>Produs</th><th className="num">Cant.</th><th className="num">Valoare</th><th className="num">Pondere</th><th className="num">Evoluție</th></tr></thead>
                <tbody>
                  {top.map((p, i) => (
                    <tr key={p.name}>
                      <td className="text-muted tabular-nums">{i + 1}</td>
                      <td className="font-medium text-ink">{p.name}</td>
                      <td className="num">{fmtNum(p.qty)}</td>
                      <td className="num">{fmtRon(p.net)}</td>
                      <td className="num text-muted">{cur.net ? `${fmtNum(Math.round((p.net / cur.net) * 1000) / 10)}%` : "—"}</td>
                      <td className="num"><Delta value={pctChange(p.net, p.prev_net)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Cele mai vândute după cantitate" pad={false}>
              <table className="table">
                <thead><tr><th>#</th><th>Produs</th><th className="num">Cant.</th><th className="num">Valoare</th></tr></thead>
                <tbody>
                  {topQty.map((p, i) => (
                    <tr key={p.name}><td className="text-muted tabular-nums">{i + 1}</td><td className="font-medium text-ink">{p.name}</td><td className="num">{fmtNum(p.qty)}</td><td className="num">{fmtRon(p.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Pe categorii" subtitle="Tipul articolului din Publine">
              {cats.length ? <Donut data={cats.map((c) => ({ name: c.category, value: c.net }))} height={170} /> : <EmptyState title="Fără date" />}
            </Card>
            <Card title="Metode de plată" subtitle="Valoare cu TVA">
              {mix.length ? <Donut data={mix.map((m) => ({ name: m.method, value: m.gross }))} height={170} /> : <EmptyState title="Fără date" />}
            </Card>
            <Card title="În creștere / în scădere" subtitle="Peste ±10% față de perioada anterioară">
              <ul className="space-y-2 text-sm">
                {growing.slice(0, 4).map((p) => <li key={p.name} className="flex justify-between gap-2"><span className="min-w-0 truncate text-ink-2">{p.name}</span><Delta value={p.change} /></li>)}
                {growing.length > 0 && declining.length > 0 && <li className="border-t border-line" />}
                {declining.slice(0, 4).map((p) => <li key={p.name} className="flex justify-between gap-2"><span className="min-w-0 truncate text-ink-2">{p.name}</span><Delta value={p.change} /></li>)}
                {!growing.length && !declining.length && <li className="text-muted">Nicio schimbare semnificativă.</li>}
              </ul>
            </Card>
          </div>

          {showCosts && (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
              <Card title="Costuri pe categorii" subtitle="Din facturile verificate, alocate pe locații" action={<TextLink href="/facturi/costuri">Detalii →</TextLink>}>
                {costs.length ? (
                  <ul className="space-y-2.5">
                    {costs.map((c) => (
                      <li key={c.category} className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3 text-xs">
                        <div>
                          <div className="flex justify-between"><span className="text-ink-2">{c.category}</span><span className="text-muted">{costTotal ? `${Math.round((c.amount / costTotal) * 100)}%` : ""}</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-crust" style={{ width: `${costTotal ? (c.amount / costTotal) * 100 : 0}%` }} /></div>
                        </div>
                        <span className="text-right tabular-nums text-ink">{fmtRon(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="Nicio factură verificată în perioadă">Facturile importate din SAGA intră în costuri după verificare.</EmptyState>}
              </Card>
              <Card title="Furnizori principali" subtitle="Valoare fără TVA în perioadă" pad={false}>
                {suppliers.length ? (
                  <table className="table">
                    <thead><tr><th>Furnizor</th><th className="num">Facturi</th><th className="num">Valoare</th></tr></thead>
                    <tbody>{suppliers.map((s) => <tr key={s.supplier}><td className="font-medium text-ink">{s.supplier}</td><td className="num">{s.invoices}</td><td className="num">{fmtRon(s.amount)}</td></tr>)}</tbody>
                  </table>
                ) : <EmptyState title="Fără costuri din facturi în perioadă" />}
              </Card>
            </div>
          )}
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Congelator" subtitle="Stoc operațional, calculat din mișcări" action={<TextLink href="/congelator">Deschide →</TextLink>}>
          {freezer.length ? (
            <>
              <div className="text-[28px] font-semibold tracking-tight tabular-nums">{fmtNum(freezerUnits)} <span className="text-base font-normal text-muted">unități</span></div>
              <div className="mt-1 text-xs text-muted">{freezer.length} produse în stoc</div>
              <ul className="mt-4 space-y-2 text-sm">
                {freezer.slice(0, 4).map((x) => (
                  <li key={`${x.location_id}-${x.product_id}`} className="flex justify-between gap-2"><span className="truncate text-ink-2">{x.product}</span><span className="tabular-nums">{fmtNum(x.qty)} {x.unit}</span></li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState icon={<Snowflake className="size-5" />} title="Nicio mișcare înregistrată">Înregistrați intrările din producție în congelator pentru a vedea stocul.</EmptyState>
          )}
        </Card>

        <Card title="Alerte" subtitle="Situații care necesită atenție">
          <ul className="space-y-3 text-sm">
            <AlertRow ok={negative.length === 0} text={negative.length ? `${negative.length} produse cu stoc operațional negativ` : "Niciun stoc negativ"} href="/stocuri" />
            <AlertRow ok={sync.failed === 0} text={sync.failed ? `${sync.failed} importuri eșuate de reluat` : "Niciun import eșuat"} href="/importuri" />
            <AlertRow ok={sync.unmappedAliases === 0} text={sync.unmappedAliases ? `${sync.unmappedAliases} gestiuni Publine neasociate` : "Toate gestiunile Publine sunt asociate"} href="/setari" />
            <AlertRow ok={ord.to_confirm + ord.to_prepare === 0} text={ord.to_confirm + ord.to_prepare ? `Comenzi: ${ord.to_confirm} de confirmat, ${ord.to_prepare} de pregătit` : "Nicio comandă de confirmat sau pregătit"} href="/comenzi" />
            <AlertRow ok={ord.in_transit === 0} text={ord.in_transit ? `${ord.in_transit} transferuri în tranzit, de recepționat` : "Niciun transfer în așteptare"} href="/comenzi" />
            {canAccess(user, "invoices") && <AlertRow ok={inv.drafts === 0} text={inv.drafts ? `${inv.drafts} facturi de verificat` : "Nicio factură de verificat"} href="/facturi" />}
            <AlertRow ok={unconfirmed.length === 0} text={unconfirmed.length ? `Plan dospire neconfirmat pentru mâine: ${unconfirmed.map((s) => s.name.replace("Warose Bakery ", "")).join(", ")}` : "Planurile de dospire pentru mâine sunt confirmate"} href="/dospire" />
            <AlertRow ok={inv.open === 0} text={inv.open ? `${inv.open} inventare în lucru` : "Niciun inventar deschis"} href="/inventar" />
            <AlertRow ok={(inv.last_value ?? 0) >= 0} text={inv.last_loc ? `Ultimul inventar (${inv.last_loc}): ${fmtRon(inv.last_value ?? 0, true)} diferență` : "Niciun inventar închis încă"} href="/inventar" />
          </ul>
        </Card>

        <Card title="Sincronizare" subtitle="Agenții de pe calculatoarele din locații" action={<TextLink href="/importuri">Detalii →</TextLink>}>
          <ul className="space-y-3 text-sm">
            {sync.agents.map((a) => {
              const fresh = a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 30 * 60000;
              return (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{a.name} <span className="font-normal text-muted">· {a.location.replace("Warose Bakery ", "")}</span></div>
                    <div className="truncate text-xs text-muted" title={a.last_status ?? ""}>Văzut {relativeTime(a.last_seen_at)} · {a.last_status ?? "fără încărcări"}</div>
                  </div>
                  <span className="shrink-0"><Badge tone={!a.active ? "neutral" : fresh ? "good" : "warn"}>{!a.active ? "Inactiv" : fresh ? "Online" : "Offline"}</Badge></span>
                </li>
              );
            })}
            {sync.agents.length === 0 && <li className="text-muted">Niciun agent configurat. Creați unul din Setări → Agenți.</li>}
            <li className="flex items-center gap-2 border-t border-line pt-3 text-xs text-muted">
              <RefreshCw className="size-3.5" />
              Ultima vânzare importată: {last.ts ? fmtLocalTs(last.ts) : "—"}
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function HeroDelta({ value }: { value: number | null }) {
  if (value == null) return <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-white/70">fără comparație</span>;
  const up = value >= 0;
  return <span className={`rounded-md px-1.5 py-0.5 font-medium ${up ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>{fmtPct(value)}</span>;
}

function HeroStat({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-white/45">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</div>
      {delta !== undefined && <div className="mt-0.5 text-[11px]"><span className={delta == null ? "text-white/40" : delta >= 0 ? "text-emerald-300" : "text-rose-300"}>{delta == null ? "—" : fmtPct(delta)}</span></div>}
      {sub && <div className="mt-0.5 truncate text-[11px] text-white/50">{sub}</div>}
    </div>
  );
}

function AlertRow({ ok, text, href }: { ok: boolean; text: string; href: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {ok ? <CheckCircle2 className="size-4 shrink-0 text-good" /> : <AlertTriangle className="size-4 shrink-0 text-warn" />}
      {ok ? <span className="text-ink-2">{text}</span> : <Link href={href} className="font-medium text-ink hover:underline">{text}</Link>}
    </li>
  );
}
