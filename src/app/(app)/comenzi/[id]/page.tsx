import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { canFulfil, canOrder, canReceive, FLOW, getOrder, orderableProducts, STATUS } from "@/lib/orders";
import { locationsFor } from "@/lib/queries";
import { Badge, Card, Notice } from "@/components/ui";
import { CancelForm, CommentForm, OrderForm, SimpleAction, StageForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comandă" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("orders");
  const o = await getOrder(user, Number((await params).id));
  if (!o) notFound();
  const st = STATUS[o.status];
  const store = canOrder(user, o.from_location_id);
  const supplier = canFulfil(user, o.to_location_id);
  const receiver = canReceive(user, o.from_location_id);
  const stepIdx = FLOW.indexOf(o.status);
  const stamps: Record<string, string | null> = { draft: o.created_at, submitted: o.submitted_at, confirmed: o.confirmed_at, preparing: null, shipped: o.shipped_at, received: o.received_at };
  const confirmedQty = (l: (typeof o.lines)[number]) => l.confirmed_qty ?? l.ordered_qty;

  let draftForm: React.ReactNode = null;
  if (o.status === "draft" && store) {
    const [from, to, products] = await Promise.all([
      locationsFor(user, ["store"]),
      q<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active AND kind IN ('freezer','production') ORDER BY kind = 'production', id"),
      orderableProducts(),
    ]);
    draftForm = <OrderForm fromLocations={from} toLocations={to} products={products}
      initial={{ order_id: o.id, from: o.from_location_id, to: o.to_location_id, needed_for: o.needed_for, note: o.note, lines: o.lines.map((l) => ({ product_id: l.product_id, qty: l.ordered_qty })) }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/comenzi" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Comenzi</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[24px] font-semibold tracking-tight text-ink">Comanda #{o.id} <Badge tone={st.tone}>{st.label}</Badge></h1>
          <p className="mt-1 text-sm text-muted">{o.from_name} ← {o.to_name} · necesar pentru {fmtDate(o.needed_for)} · creată de {o.author}{o.note && ` · ${o.note}`}</p>
        </div>
        {["shipped", "received"].includes(o.status) && <Link href={`/comenzi/${o.id}/aviz`} className="btn btn-ghost"><Printer className="size-4" />Document de transfer</Link>}
      </div>

      {o.status !== "cancelled" ? (
        <ol className="card grid grid-cols-3 gap-y-3 p-4 sm:grid-cols-6">
          {FLOW.map((s, i) => {
            const done = i <= stepIdx;
            return (
              <li key={s} className="flex items-center gap-2">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${done ? "bg-ink text-white" : "bg-canvas text-faint ring-1 ring-line"}`}>{done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}</span>
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${done ? "text-ink" : "text-faint"}`}>{STATUS[s].label}</span>
                  {stamps[s] && <span className="block truncate text-[11px] text-muted">{fmtDateTime(stamps[s])}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : <Notice tone="warn" title="Comandă anulată">{fmtDateTime(o.cancelled_at)}{o.cancel_reason && ` — ${o.cancel_reason}`}</Notice>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {draftForm ? <Card title="Ciornă" subtitle="Modificați și trimiteți când comanda este completă">{draftForm}</Card> : null}

          {o.status === "submitted" && supplier && (
            <Card title="Verificare disponibilitate și confirmare" subtitle={`Stocul din ${o.to_name}, din care rezervat pentru alte comenzi active`}>
              <StageForm kind="confirm" orderId={o.id} header="Confirmat" lines={o.lines.map((l) => {
                const free = l.source_stock - l.reserved_other;
                return {
                  id: l.id, product: l.product, unit: l.unit, value: l.ordered_qty,
                  info: <>comandat <b className="text-ink">{fmtNum(l.ordered_qty)}</b> · stoc {fmtNum(l.source_stock)}{l.reserved_other > 0 && <>, rezervat {fmtNum(l.reserved_other)}</>} · <span className={free < l.ordered_qty ? "font-medium text-bad" : "text-good"}>liber {fmtNum(free)}</span></>,
                };
              })} />
            </Card>
          )}

          {["confirmed", "preparing"].includes(o.status) && supplier && (
            <Card title="Expediere" subtitle="Cantitățile efectiv încărcate; stocul furnizorului scade pe loturi, cele mai vechi întâi">
              <StageForm kind="ship" orderId={o.id} header="Expediat" lines={o.lines.map((l) => ({
                id: l.id, product: l.product, unit: l.unit, value: confirmedQty(l),
                info: <>confirmat <b className="text-ink">{fmtNum(confirmedQty(l))}</b> · în stoc {fmtNum(l.source_stock)}</>,
              }))} />
            </Card>
          )}

          {o.status === "shipped" && receiver && (
            <Card title="Recepție" subtitle="Numărați marfa la sosire; diferențele se înregistrează automat">
              <StageForm kind="receive" orderId={o.id} header="Recepționat" lines={o.lines.filter((l) => (l.shipped_qty ?? 0) > 0 || l.ordered_qty > 0).map((l) => ({
                id: l.id, product: l.product, unit: l.unit, value: l.shipped_qty ?? 0,
                info: <>expediat <b className="text-ink">{fmtNum(l.shipped_qty ?? 0)}</b></>,
              }))} />
            </Card>
          )}

          {!draftForm && (
            <Card title="Cantități" subtitle="Comandat → confirmat → expediat → recepționat" pad={false}>
              <table className="table">
                <thead><tr><th>Produs</th><th className="num">Comandat</th><th className="num">Confirmat</th><th className="num">Expediat</th><th className="num">Recepționat</th><th className="num">Diferență</th></tr></thead>
                <tbody>
                  {o.lines.map((l) => {
                    const diff = l.received_qty != null ? l.received_qty - l.ordered_qty : null;
                    const cell = (v: number | null, prev: number | null) => v == null ? <span className="text-faint">—</span>
                      : <span className={prev != null && Math.abs(v - prev) > 1e-9 ? "font-medium text-warn" : ""}>{fmtNum(v)}</span>;
                    return (
                      <tr key={l.id}>
                        <td className="font-medium text-ink">{l.product}</td>
                        <td className="num">{fmtNum(l.ordered_qty)} <span className="text-muted">{l.unit}</span></td>
                        <td className="num">{cell(l.confirmed_qty, l.ordered_qty)}</td>
                        <td className="num">{cell(l.shipped_qty, l.confirmed_qty ?? l.ordered_qty)}</td>
                        <td className="num">{cell(l.received_qty, l.shipped_qty)}</td>
                        <td className={`num ${diff && diff < 0 ? "text-bad" : diff && diff > 0 ? "text-good" : "text-muted"}`}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${fmtNum(diff)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {o.shipments.length > 0 && (
            <Card title="Loturi expediate" pad={false}>
              <table className="table">
                <thead><tr><th>Produs</th><th>Lot</th><th>Produs la</th><th>Expiră</th><th className="num">Cantitate</th></tr></thead>
                <tbody>
                  {o.shipments.map((s, i) => (
                    <tr key={i}><td className="font-medium text-ink">{s.product}</td><td className="text-xs">{s.lot ?? "fără lot"}</td><td className="text-xs">{fmtDate(s.produced_on)}</td><td className="text-xs">{fmtDate(s.expires_on)}</td><td className="num">{fmtNum(s.qty)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Acțiuni">
            <div className="space-y-2">
              {o.status === "draft" && store && <SimpleAction kind="submit" orderId={o.id} label="Trimite fără modificări" />}
              {o.status === "confirmed" && supplier && <SimpleAction kind="prepare" orderId={o.id} label="Marchează „În pregătire”" />}
              {o.status === "submitted" && !supplier && <Notice>Așteaptă confirmarea din {o.to_name}.</Notice>}
              {["confirmed", "preparing"].includes(o.status) && !supplier && <Notice>Comanda se pregătește în {o.to_name}.</Notice>}
              {o.status === "shipped" && !receiver && <Notice>Marfa este în tranzit; recepția se face în {o.from_name}.</Notice>}
              {o.status === "received" && <Notice tone="good">Recepționată {fmtDateTime(o.received_at)}. Stocurile ambelor locații au fost actualizate.</Notice>}
              {(supplier ? ["draft", "submitted", "confirmed", "preparing"] : store ? ["draft", "submitted"] : []).includes(o.status) && (
                <CancelForm orderId={o.id} needsReason={o.status !== "draft"} />
              )}
            </div>
          </Card>

          <Card title="Istoric" subtitle="Toate schimbările, cu utilizator și oră">
            <ol className="relative space-y-4 border-l border-line pl-4">
              {o.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-surface ${e.kind === "comment" ? "bg-info" : e.status === "cancelled" ? "bg-bad" : "bg-ink"}`} />
                  <div className="text-xs text-muted">{fmtDateTime(e.at)} · {e.user_name ?? "sistem"}</div>
                  <div className="mt-0.5 text-sm text-ink-2">{e.kind === "comment" ? <span className="italic">„{e.message}”</span> : <>{e.status && <Badge tone={STATUS[e.status as keyof typeof STATUS]?.tone ?? "neutral"}>{STATUS[e.status as keyof typeof STATUS]?.label ?? e.status}</Badge>} {e.message}</>}</div>
                </li>
              ))}
            </ol>
            <div className="mt-4 border-t border-line pt-4"><CommentForm orderId={o.id} /></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
