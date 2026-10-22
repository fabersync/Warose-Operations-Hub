import Link from "next/link";
import { AlertTriangle, CheckCircle2, RefreshCw, Snowflake, UploadCloud } from "lucide-react";
import { requireUser, canAccess } from "@/lib/auth";
import { q } from "@/lib/db";
import { addDays, daysBetween, fmtDate, fmtLocalTs, fmtNum, fmtRon, monthStart, pctChange, relativeTime, todayLocal } from "@/lib/format";
import { lastSaleTimestamp, productPerformance, salesByDay, salesByLocation, salesTotals, stockLevels, syncStatus } from "@/lib/queries";
import { Badge, Card, Delta, EmptyState, Kpi, Notice, PageHeader, TextLink } from "@/components/ui";
import { SalesTrend } from "@/components/Charts";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (!canAccess(user, "dashboard")) {
    return <PageHeader title={`Bună, ${user.name}`} description="Folosiți meniul pentru operațiunile la care aveți acces." />;
  }

  const last = await lastSaleTimestamp(user);
  const today = todayLocal();
  // Ziua de referință = ultima zi pentru care există vânzări importate (marcată explicit în interfață).
  const ref = last.d ?? today;
  const mStart = monthStart(ref);
  const elapsed = daysBetween(mStart, ref);
  const prevMStart = monthStart(addDays(mStart, -1));
  const prevMEnd = addDays(prevMStart, Math.min(elapsed, daysBetween(prevMStart, addDays(mStart, -1))) - 1);

  const [day, dayPrevWeek, month, prevMonth, trend, byLoc, perf, freezer, stock, sync] = await Promise.all([
    salesTotals(user, { from: ref, to: ref }),
    salesTotals(user, { from: addDays(ref, -7), to: addDays(ref, -7) }),
    salesTotals(user, { from: mStart, to: ref }),
    salesTotals(user, { from: prevMStart, to: prevMEnd }),
    salesByDay(user, { from: addDays(ref, -34), to: ref }),
    salesByLocation(user, { from: mStart, to: ref }, { from: prevMStart, to: prevMEnd }),
    productPerformance(user, { from: mStart, to: ref }, { from: prevMStart, to: prevMEnd }),
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
  // Magazinele fără plan de dospire confirmat pentru dimineața următoare.
  const tomorrow = addDays(today, 1);
  const proofStores = await q<{ name: string; status: string | null }>(
    `SELECT l.name, p.status FROM locations l
       LEFT JOIN proofing_plans p ON p.location_id = l.id AND p.plan_date = $1 AND p.status <> 'cancelled'
      WHERE l.kind = 'store' AND l.active${user.locationIds === null ? "" : " AND l.id = ANY($2::int[])"}`,
    user.locationIds === null ? [tomorrow] : [tomorrow, user.locationIds],
  );
  const unconfirmed = proofStores.filter((s) => s.status !== "confirmed");
  // Comenzi: de confirmat / pregătit (furnizor) și în tranzit (de recepționat).
  const ordScope = user.locationIds === null ? "TRUE" : "(to_location_id = ANY($1::int[]) OR from_location_id = ANY($1::int[]))";
  const [ord] = await q<{ to_confirm: number; to_prepare: number; in_transit: number }>(
    `SELECT count(*) FILTER (WHERE status = 'submitted')::int to_confirm,
            count(*) FILTER (WHERE status IN ('confirmed', 'preparing'))::int to_prepare,
            count(*) FILTER (WHERE status = 'shipped')::int in_transit
       FROM location_orders WHERE ${ordScope}`,
    user.locationIds === null ? [] : [user.locationIds],
  );

  const top = [...perf].sort((a, b) => b.net - a.net).slice(0, 6);
  const declining = perf
    .filter((p) => p.prev_net >= 150)
    .map((p) => ({ ...p, change: pctChange(p.net, p.prev_net)! }))
    .filter((p) => p.change < -10)
    .sort((a, b) => a.change - b.change)
    .slice(0, 6);
  const negative = stock.filter((s) => s.qty < 0);
  const staleDays = last.d ? daysBetween(last.d, today) - 1 : null;
  const avgTicket = month.receipts ? month.net / month.receipts : 0;
  const prevAvgTicket = prevMonth.receipts ? prevMonth.net / prevMonth.receipts : 0;
  const freezerUnits = freezer.reduce((s, f) => s + f.qty, 0);

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" }).format(new Date())}
        title={`Bună, ${user.name.split(" ")[0]}`}
        description="Imaginea de ansamblu a operațiunilor. Toate cifrele provin din date importate și reconciliate — nu există valori demonstrative."
        actions={canAccess(user, "imports") ? <Link href="/importuri" className="btn btn-ghost"><UploadCloud className="size-4" />Importuri</Link> : null}
      />

      {sp.denied && <div className="mb-5"><Notice tone="warn">Nu aveți acces la modulul solicitat.</Notice></div>}

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
                Cifrele de mai jos se referă la ziua și luna ultimelor date disponibile. Verificați agentul de sincronizare din locație.
              </Notice>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label={`Vânzări nete · ${fmtDate(ref)}`} value={fmtRon(day.net)} delta={pctChange(day.net, dayPrevWeek.net)} deltaSuffix="vs. săpt. trecută" />
            <Kpi label={`Luna până la ${fmtDate(ref).slice(0, 6)}`} value={fmtRon(month.net)} delta={pctChange(month.net, prevMonth.net)} deltaSuffix={`vs. ${elapsed} zile luna trecută`} />
            <Kpi label="Bonuri în lună" value={fmtNum(month.receipts)} delta={pctChange(month.receipts, prevMonth.receipts)} deltaSuffix="vs. luna trecută" />
            <Kpi label="Bon mediu (net)" value={fmtRon(avgTicket, true)} delta={pctChange(avgTicket, prevAvgTicket)} deltaSuffix="vs. luna trecută" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Evoluția vânzărilor nete" subtitle="Ultimele 35 de zile, fără TVA" action={<TextLink href="/vanzari">Analiză detaliată →</TextLink>}>
              <SalesTrend data={trend} />
            </Card>
            <Card title="Performanța locațiilor" subtitle={`Luna curentă vs. aceleași ${elapsed} zile din luna trecută`}>
              <ul className="space-y-4">
                {byLoc.map((l) => {
                  const max = Math.max(...byLoc.map((x) => x.net), 1);
                  return (
                    <li key={l.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{l.name}</span>
                        <span className="text-sm tabular-nums text-ink">{fmtRon(l.net)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-crust" style={{ width: `${(l.net / max) * 100}%` }} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                        <span>{fmtNum(l.receipts)} bonuri</span>
                        <Delta value={pctChange(l.net, l.prevNet)} />
                      </div>
                    </li>
                  );
                })}
                {byLoc.length === 0 && <li className="text-sm text-muted">Fără vânzări în luna curentă.</li>}
              </ul>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Cele mai vândute produse" subtitle="Luna curentă, după valoare netă" pad={false}>
              <table className="table">
                <thead><tr><th>Produs</th><th className="num">Cant.</th><th className="num">Valoare</th><th className="num">Evoluție</th></tr></thead>
                <tbody>
                  {top.map((p) => (
                    <tr key={p.name}>
                      <td className="font-medium text-ink">{p.name}</td>
                      <td className="num">{fmtNum(p.qty)}</td>
                      <td className="num">{fmtRon(p.net)}</td>
                      <td className="num"><Delta value={pctChange(p.net, p.prev_net)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Produse în scădere" subtitle="Scădere de peste 10% față de aceeași perioadă a lunii trecute" pad={false}>
              {declining.length ? (
                <table className="table">
                  <thead><tr><th>Produs</th><th className="num">Acum</th><th className="num">Înainte</th><th className="num">Evoluție</th></tr></thead>
                  <tbody>
                    {declining.map((p) => (
                      <tr key={p.name}>
                        <td className="font-medium text-ink">{p.name}</td>
                        <td className="num">{fmtRon(p.net)}</td>
                        <td className="num text-muted">{fmtRon(p.prev_net)}</td>
                        <td className="num"><Delta value={p.change} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <EmptyState title="Niciun produs în scădere semnificativă" />}
            </Card>
          </div>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Congelator" subtitle="Stoc operațional, calculat din mișcări" action={<TextLink href="/congelator">Deschide →</TextLink>}>
          {freezer.length ? (
            <>
              <div className="text-[28px] font-semibold tracking-tight tabular-nums">{fmtNum(freezerUnits)} <span className="text-base font-normal text-muted">unități</span></div>
              <div className="mt-1 text-xs text-muted">{freezer.length} produse în stoc</div>
              <ul className="mt-4 space-y-2 text-sm">
                {freezer.slice(0, 4).map((f) => (
                  <li key={`${f.location_id}-${f.product_id}`} className="flex justify-between gap-2"><span className="truncate text-ink-2">{f.product}</span><span className="tabular-nums">{fmtNum(f.qty)} {f.unit}</span></li>
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

        <Card title="Sincronizare" subtitle="Agenții de pe calculatoarele Publine" action={<TextLink href="/importuri">Detalii →</TextLink>}>
          <ul className="space-y-3 text-sm">
            {sync.agents.map((a) => {
              const fresh = a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 30 * 60000;
              return (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{a.location}</div>
                    <div className="text-xs text-muted">Văzut {relativeTime(a.last_seen_at)} · {a.last_status ?? "fără încărcări"}</div>
                  </div>
                  <Badge tone={!a.active ? "neutral" : fresh ? "good" : "warn"}>{!a.active ? "Inactiv" : fresh ? "Online" : "Offline"}</Badge>
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

function AlertRow({ ok, text, href }: { ok: boolean; text: string; href: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {ok ? <CheckCircle2 className="size-4 shrink-0 text-good" /> : <AlertTriangle className="size-4 shrink-0 text-warn" />}
      {ok ? <span className="text-ink-2">{text}</span> : <Link href={href} className="font-medium text-ink hover:underline">{text}</Link>}
    </li>
  );
}

