import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { canEditProduction, getOrder, ORDER_STATUS, requirementsFor } from "@/lib/production";
import { Badge, Card, Notice } from "@/components/ui";
import { ApproveForm, ConsumptionForm, RecordForm } from "../OrderForms";
import { cancelOrder, markSaga } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document de producție" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("production");
  const order = await getOrder(user, Number((await params).id));
  if (!order) notFound();
  const edit = canEditProduction(user);
  const st = ORDER_STATUS[order.status];
  const requirements = order.status === "planned"
    ? await requirementsFor(order.lines.map((l) => ({ product_id: l.product_id, qty: l.planned_qty })), order.location_id)
    : [];
  const missingSaga = order.lines.filter((l) => (l.produced_qty ?? 0) > 0 && !l.saga_code).length + order.consumption.filter((c) => !c.saga_code).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/productie" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Documente</Link>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">Producție #{order.id} · {fmtDate(order.planned_for)} <Badge tone={st.tone}>{st.label}</Badge></h2>
          <p className="mt-1 text-sm text-muted">
            {order.location}{order.freezer && ` → ${order.freezer}`} · planificat de {order.author}
            {order.recorded_by && ` · înregistrat de ${order.recorded_by}, ${fmtDateTime(order.recorded_at)}`}
            {order.approved_by && ` · aprobat de ${order.approved_by}, ${fmtDateTime(order.approved_at)}`}
            {order.note && ` · ${order.note}`}
          </p>
        </div>
        {order.status === "approved" && <a href={`/api/export/production/${order.id}`} className="btn btn-primary"><Download className="size-4" />Document pentru SAGA</a>}
      </div>

      {order.status === "planned" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card title="Înregistrează producția reală" subtitle="Cantitățile efectiv obținute; consumul de materii prime se calculează din rețete">
            {edit ? <RecordForm orderId={order.id} lines={order.lines} hasFreezer={!!order.freezer_location_id} /> : <PlannedTable lines={order.lines} />}
          </Card>
          <Card title="Necesar materii prime" subtitle={`Față de stocul din ${order.location}`}>
            {requirements.length ? (
              <ul className="space-y-2.5 text-sm">
                {requirements.map((r) => {
                  const short = r.track_stock && r.available < r.needed;
                  return (
                    <li key={r.ingredient_id}>
                      <div className="flex justify-between gap-2"><span className="text-ink-2">{r.name}</span><span className="tabular-nums font-medium">{fmtNum(Math.round(r.needed * 1000) / 1000)} {r.unit}</span></div>
                      <div className="text-xs">
                        {r.track_stock
                          ? <span className={short ? "text-bad" : "text-muted"}>în stoc {fmtNum(Math.round(r.available * 1000) / 1000)} {r.unit}{short && ` — lipsesc ${fmtNum(Math.round((r.needed - r.available) * 1000) / 1000)}`}</span>
                          : <span className="text-faint">stoc negestionat în aplicație</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted">Niciun produs din plan nu are rețetă.</p>}
          </Card>
        </div>
      )}

      {order.status === "recorded" && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Produse obținute" subtitle="Puteți corecta cantitățile până la aprobare">
              {edit ? <RecordForm orderId={order.id} lines={order.lines} hasFreezer={!!order.freezer_location_id} /> : <ProducedTable lines={order.lines} />}
            </Card>
            <Card title="Aprobare" subtitle="Verificarea înainte de stoc și SAGA">
              <ul className="mb-4 space-y-1.5 text-sm text-ink-2">
                <li>+ produse finite în {order.location}, pe lotul documentului</li>
                {order.freezer && <li>→ transfer către {order.freezer} pentru cantitatea congelată</li>}
                <li>− rebuturi</li>
                <li>− consum de materii prime cu stoc gestionat</li>
              </ul>
              {edit ? (
                <>
                  <ApproveForm orderId={order.id} />
                  <form action={cancelOrder} className="mt-2"><input type="hidden" name="order_id" value={order.id} /><button className="btn btn-danger w-full">Anulează documentul</button></form>
                </>
              ) : <Notice>Aprobarea o face responsabilul BRUTĂRIE sau administratorul.</Notice>}
            </Card>
          </div>
          <Card title="Consum de materii prime" subtitle="Teoretic din rețetă; completați efectivul doar dacă s-a cântărit" pad={false}>
            <div className="p-4 sm:p-5">
              {order.consumption.length ? <ConsumptionForm orderId={order.id} rows={order.consumption} editable={edit} /> : <p className="text-sm text-muted">Niciun consum calculat (produsele nu au rețetă).</p>}
            </div>
          </Card>
        </>
      )}

      {order.status === "approved" && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Produse obținute" pad={false}><ProducedTable lines={order.lines} /></Card>
            <Card title="SAGA C" subtitle="Documentul se introduce în SAGA de contabilitate; aplicația nu scrie în baza SAGA">
              {order.saga_doc_no ? (
                <Notice tone="good" title={`Introdus în SAGA cu nr. ${order.saga_doc_no}`}>Marcat la {fmtDateTime(order.saga_registered_at)}.</Notice>
              ) : (
                <>
                  {missingSaga > 0 && <div className="mb-3"><Notice tone="warn">{missingSaga} articole nu au cod SAGA asociat. Asocierea se face din Comparație SAGA sau Produse & coduri.</Notice></div>}
                  {edit && (
                    <form action={markSaga} className="space-y-2">
                      <input type="hidden" name="order_id" value={order.id} />
                      <label className="label" htmlFor="saga_doc_no">Nr. document în SAGA</label>
                      <input id="saga_doc_no" name="saga_doc_no" required className="input" placeholder="ex: 4893" />
                      <button className="btn btn-ghost w-full">Marchează ca introdus</button>
                    </form>
                  )}
                </>
              )}
            </Card>
          </div>
          {order.consumption.length > 0 && (
            <Card title="Consum de materii prime" pad={false}><div className="p-4 sm:p-5"><ConsumptionForm orderId={order.id} rows={order.consumption} editable={false} /></div></Card>
          )}
        </>
      )}

      {order.status === "cancelled" && (
        <>
          <Notice tone="warn">Document anulat. Nu a modificat stocurile.</Notice>
          <Card title="Plan" pad={false}><PlannedTable lines={order.lines} /></Card>
        </>
      )}
    </div>
  );
}

type L = { id: number; product: string; unit: string; planned_qty: number; produced_qty: number | null; to_freezer_qty: number | null; scrap_qty: number | null; recipe_version: number | null; saga_code: string | null };

function PlannedTable({ lines }: { lines: L[] }) {
  return (
    <table className="table">
      <thead><tr><th>Produs</th><th className="num">Planificat</th></tr></thead>
      <tbody>{lines.map((l) => <tr key={l.id}><td className="font-medium text-ink">{l.product}</td><td className="num">{fmtNum(l.planned_qty)} {l.unit}</td></tr>)}</tbody>
    </table>
  );
}

function ProducedTable({ lines }: { lines: L[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Produs</th><th className="num">Planificat</th><th className="num">Produs</th><th className="num">Congelat</th><th className="num">Rebut</th><th>Rețetă</th><th>Cod SAGA</th></tr></thead>
        <tbody>
          {lines.map((l) => {
            const dev = l.produced_qty != null && l.planned_qty ? ((l.produced_qty - l.planned_qty) / l.planned_qty) * 100 : null;
            return (
              <tr key={l.id}>
                <td className="font-medium text-ink">{l.product}</td>
                <td className="num text-muted">{fmtNum(l.planned_qty)}</td>
                <td className="num">{fmtNum(l.produced_qty)} {dev != null && Math.abs(dev) >= 1 && <span className={`text-xs ${dev < 0 ? "text-bad" : "text-good"}`}>{dev > 0 ? "+" : ""}{Math.round(dev)}%</span>}</td>
                <td className="num">{fmtNum(l.to_freezer_qty ?? 0)}</td>
                <td className="num">{fmtNum(l.scrap_qty ?? 0)}</td>
                <td className="text-xs">{l.recipe_version ? `v${l.recipe_version}` : <span className="text-warn">fără</span>}</td>
                <td className="font-mono text-xs">{l.saga_code ?? <span className="font-sans text-warn">neasociat</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
