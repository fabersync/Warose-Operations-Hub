import Link from "next/link";
import { AlertTriangle, Info, Settings2, Timer, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { addDays, fmtDate, fmtDateTime, fmtNum, todayLocal } from "@/lib/format";
import { canPlanProofing, fmtOffset, getPlan, locationSettings, nowOffset, planWarnings, proofableProducts, schedule, weekOverview } from "@/lib/proofing";
import { locationsFor } from "@/lib/queries";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { cancelPlan, createPlan, reopenPlan, setReadyTime } from "./actions";
import { AddItemForm, ConfirmForm, QtyCell, TaskList } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan dospire" };

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function ProofingPage({ searchParams }: { searchParams: Promise<{ loc?: string; d?: string }> }) {
  const user = await requireUser("proofing");
  const sp = await searchParams;
  const locations = await locationsFor(user, ["store", "production"]);
  if (!locations.length) return <><PageHeader title="Plan dospire" /><Notice tone="warn">Nu aveți acces la nicio locație.</Notice></>;

  const today = todayLocal();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  // După prânz, planul relevant este cel pentru dimineața următoare.
  const date = isDate(sp.d) ? sp.d! : hour >= 12 ? addDays(today, 1) : today;
  const loc = locations.find((l) => l.id === Number(sp.loc)) ?? locations[0];
  const planner = canPlanProofing(user);

  const [plan, settings, week, products] = await Promise.all([
    getPlan(loc.id, date),
    locationSettings(loc.id),
    weekOverview(user, today, 7),
    proofableProducts(),
  ]);
  const link = (p: { loc?: number; d?: string }) => `/dospire?${new URLSearchParams({ loc: String(p.loc ?? loc.id), d: p.d ?? date })}`;

  const tasks = plan ? schedule(date, plan.ready_time, plan.items) : [];
  const now = nowOffset(date);
  const warnings = plan ? planWarnings(date, plan.status, plan.ready_time, plan.items, settings.capacity) : [];
  const firstIn = tasks[0];
  const listed = new Set(plan?.items.map((i) => i.product_id));

  return (
    <>
      <PageHeader
        title="Plan dospire"
        description="Ce se scoate din congelator, când intră în dospitor și la cuptor, ca produsele să fie gata la ora stabilită. Orele se calculează din duratele configurate pe fiecare produs."
        actions={<Link href="/dospire/setari" className="btn btn-ghost"><Settings2 className="size-4" />Setări dospire</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {locations.map((l) => (
          <Link key={l.id} href={link({ loc: l.id })} className={`rounded-md px-3 py-1.5 text-xs font-medium ${l.id === loc.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</Link>
        ))}
        <form className="ml-auto flex items-center gap-1.5">
          <input type="hidden" name="loc" value={loc.id} />
          <input type="date" name="d" defaultValue={date} className="input w-auto py-1.5" aria-label="Data" />
          <button className="btn btn-ghost py-1.5">Arată</button>
        </form>
      </div>

      <div className="mb-5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
          const w = week.find((x) => x.location_id === loc.id && x.plan_date === d);
          const active = d === date;
          return (
            <Link key={d} href={link({ d })} className={`rounded-lg border px-2 py-2 text-center ${active ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-line-strong"}`}>
              <div className={`text-[11px] uppercase ${active ? "text-white/60" : "text-muted"}`}>{new Intl.DateTimeFormat("ro-RO", { weekday: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"))}</div>
              <div className="text-sm font-semibold tabular-nums">{d.slice(8)}.{d.slice(5, 7)}</div>
              <div className={`mt-0.5 truncate text-[11px] ${active ? "text-white/70" : w?.status === "confirmed" ? "text-good" : w ? "text-warn" : "text-faint"}`}>
                {w ? `${w.status === "confirmed" ? "confirmat" : "ciornă"} · ${fmtNum(w.qty)}` : "—"}
              </div>
            </Link>
          );
        })}
      </div>

      {!plan ? (
        <Card>
          <EmptyState icon={<Timer className="size-5" />} title={`Niciun plan pentru ${loc.name}, ${fmtDate(date)}`}
            action={planner ? (
              <div className="flex flex-wrap justify-center gap-2">
                <form action={createPlan}><input type="hidden" name="location_id" value={loc.id} /><input type="hidden" name="plan_date" value={date} /><input type="hidden" name="propose" value="1" /><button className="btn btn-primary">Creează cu propuneri din vânzări</button></form>
                <form action={createPlan}><input type="hidden" name="location_id" value={loc.id} /><input type="hidden" name="plan_date" value={date} /><button className="btn btn-ghost">Plan gol</button></form>
              </div>
            ) : undefined}>
            {planner
              ? <>Propunerea folosește media vânzărilor Publine din ultimele 4 zile de {new Intl.DateTimeFormat("ro-RO", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"))} pentru produsele cu durate configurate. Gata la {settings.ready_time.slice(0, 5)}.</>
              : "Planul este creat de managerul locației sau de responsabilul BRUTĂRIE."}
          </EmptyState>
        </Card>
      ) : (
        <>
          {warnings.length > 0 && (
            <ul className="mb-4 space-y-2">
              {warnings.map((w) => (
                <li key={w.text} className={`flex gap-2.5 rounded-xl border px-4 py-2.5 text-sm ${w.tone === "bad" ? "border-bad/25 bg-bad-soft" : w.tone === "warn" ? "border-warn/25 bg-warn-soft" : "border-info/20 bg-info-soft"}`}>
                  {w.tone === "bad" ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" /> : w.tone === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
                  <span className="text-ink-2">{w.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card
              title={plan.status === "confirmed" ? "Sarcini" : "Previzualizare sarcini"}
              subtitle={firstIn ? <>Primul pas la {fmtOffset(date, firstIn.offset)} · gata la {plan.ready_time.slice(0, 5)}, {fmtDate(date)}</> : "Adăugați produse cu durate configurate"}
            >
              {tasks.length ? (
                <TaskList
                  interactive={plan.status === "confirmed"}
                  tasks={tasks.map((t) => ({
                    itemId: t.itemId, kind: t.kind, product: t.product, qty: t.qty, unit: t.unit, label: t.label,
                    time: fmtOffset(date, t.offset), doneAt: t.doneAt ? String(t.doneAt) : null, doneBy: t.doneBy, late: t.offset < now,
                  }))}
                />
              ) : <p className="text-sm text-muted">Nicio sarcină încă.</p>}
            </Card>

            <div className="space-y-4">
              <Card title="Produse în plan" subtitle={<>{plan.status === "confirmed" ? <Badge tone="good">Confirmat</Badge> : <Badge tone="warn">Ciornă</Badge>} · creat de {plan.author}{plan.confirmed_by && `, confirmat de ${plan.confirmed_by} ${fmtDateTime(plan.confirmed_at)}`}</>} pad={false}>
                {plan.items.length ? (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>Produs</th><th className="num">Cantitate</th><th className="num">Stoc loc.</th><th className="num">Durată</th></tr></thead>
                      <tbody>
                        {plan.items.map((i) => (
                          <tr key={i.id}>
                            <td className="font-medium text-ink">
                              {i.product}
                              {i.suggested_qty != null && <div className="text-xs font-normal text-muted">propus din vânzări: {fmtNum(i.suggested_qty)}</div>}
                            </td>
                            <td className="num">{plan.status === "draft" && planner ? <QtyCell planId={plan.id} productId={i.product_id} qty={i.qty} /> : `${fmtNum(i.qty)} ${i.unit}`}</td>
                            <td className={`num ${i.stock_location < i.qty ? "text-bad" : ""}`}>{fmtNum(i.stock_location)}</td>
                            <td className="num text-xs">{i.proof != null ? `${(i.thaw ?? 0) + i.proof + (i.bake ?? 0)} min` : <Badge tone="bad">lipsă</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="p-5 text-sm text-muted">Planul nu are produse.</p>}
                {plan.status === "draft" && planner && (
                  <div className="space-y-3 border-t border-line p-4">
                    <AddItemForm planId={plan.id} products={products.filter((p) => !listed.has(p.id))} />
                    <form action={setReadyTime} className="flex items-center gap-2">
                      <input type="hidden" name="plan_id" value={plan.id} />
                      <label className="label shrink-0" htmlFor="ready_time">Gata la</label>
                      <input id="ready_time" name="ready_time" type="time" defaultValue={plan.ready_time.slice(0, 5)} className="input w-28 py-1.5" />
                      <button className="btn btn-ghost py-1.5">Schimbă</button>
                    </form>
                    <p className="text-xs text-muted">Cantitatea 0 elimină produsul. Modificarea se salvează la ieșirea din câmp.</p>
                  </div>
                )}
              </Card>

              {planner && (
                <Card title="Acțiuni">
                  <div className="space-y-2">
                    {plan.status === "draft" ? <ConfirmForm planId={plan.id} /> : (
                      <form action={reopenPlan}><input type="hidden" name="plan_id" value={plan.id} /><button className="btn btn-ghost w-full" title="Posibil doar înainte de bifarea primei sarcini">Readu la ciornă</button></form>
                    )}
                    <form action={cancelPlan}><input type="hidden" name="plan_id" value={plan.id} /><button className="btn btn-danger w-full">Anulează planul</button></form>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
