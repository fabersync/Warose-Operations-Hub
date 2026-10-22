"use client";
import { useActionState } from "react";
import { approveOrder, recordProduction, saveActualConsumption, type FormState } from "./actions";

const n = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const fmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 3 });

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}

type Line = { id: number; product: string; unit: string; planned_qty: number; produced_qty: number | null; to_freezer_qty: number | null; scrap_qty: number | null; expires_on: string | null; has_active_recipe: boolean };

export function RecordForm({ orderId, lines, hasFreezer }: { orderId: number; lines: Line[]; hasFreezer: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordProduction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Produs</th><th className="num">Planificat</th><th className="num">Produs efectiv</th>{hasFreezer && <th className="num">Din care la congelare</th>}<th className="num">Rebut</th>{hasFreezer && <th>Expiră (congelat)</th>}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="font-medium text-ink">
                  <input type="hidden" name="line_id" value={l.id} />
                  {l.product}
                  {!l.has_active_recipe && <div className="text-xs font-normal text-warn">fără rețetă — nu se calculează consum</div>}
                </td>
                <td className="num text-muted">{fmt.format(l.planned_qty)} {l.unit}</td>
                <td className="num"><input name="produced_qty" defaultValue={n(l.produced_qty ?? l.planned_qty)} inputMode="decimal" required aria-label={`Produs efectiv ${l.product}`} className="input w-24 py-1.5 text-right" /></td>
                {hasFreezer ? (
                  <td className="num"><input name="to_freezer_qty" defaultValue={n(l.to_freezer_qty)} inputMode="decimal" placeholder="0" aria-label={`La congelare ${l.product}`} className="input w-24 py-1.5 text-right" /></td>
                ) : <input type="hidden" name="to_freezer_qty" value="0" />}
                <td className="num"><input name="scrap_qty" defaultValue={n(l.scrap_qty)} inputMode="decimal" placeholder="0" aria-label={`Rebut ${l.product}`} className="input w-20 py-1.5 text-right" /></td>
                {hasFreezer ? (
                  <td><input name="expires_on" type="date" defaultValue={l.expires_on ?? ""} aria-label={`Expirare ${l.product}`} className="input py-1.5" /></td>
                ) : <input type="hidden" name="expires_on" value="" />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Msg state={state} />
      <button className="btn btn-primary" disabled={pending}>{pending ? "Se calculează consumul…" : "Înregistrează producția"}</button>
    </form>
  );
}

type Cons = { ingredient_id: number; name: string; unit: string; theoretical_qty: number; actual_qty: number | null; unit_cost: number | null; track_stock: boolean };

export function ConsumptionForm({ orderId, rows, editable }: { orderId: number; rows: Cons[]; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveActualConsumption, {});
  const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2 });
  const total = rows.reduce((s, r) => s + (r.actual_qty ?? r.theoretical_qty) * (r.unit_cost ?? 0), 0);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Materie primă</th><th className="num">Teoretic</th><th className="num">Efectiv</th><th className="num">Diferență</th><th className="num">Cost</th><th>În stoc</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.actual_qty != null ? r.actual_qty - r.theoretical_qty : null;
              return (
                <tr key={r.ingredient_id}>
                  <td className="font-medium text-ink"><input type="hidden" name="ingredient_id" value={r.ingredient_id} />{r.name}</td>
                  <td className="num">{fmt.format(r.theoretical_qty)} <span className="text-muted">{r.unit}</span></td>
                  <td className="num">
                    {editable
                      ? <input name="actual_qty" defaultValue={n(r.actual_qty)} inputMode="decimal" placeholder="= teoretic" aria-label={`Consum efectiv ${r.name}`} className="input w-24 py-1.5 text-right" />
                      : r.actual_qty != null ? fmt.format(r.actual_qty) : <span className="text-muted">= teoretic</span>}
                  </td>
                  <td className={`num ${diff && diff > 0 ? "text-bad" : diff && diff < 0 ? "text-good" : "text-muted"}`}>
                    {diff != null && Math.abs(diff) > 1e-9 ? `${diff > 0 ? "+" : ""}${fmt.format(diff)} (${Math.round((diff / r.theoretical_qty) * 100)}%)` : "—"}
                  </td>
                  <td className="num">{r.unit_cost != null ? ron.format((r.actual_qty ?? r.theoretical_qty) * r.unit_cost) : <span className="text-xs text-warn">fără preț</span>}</td>
                  <td className="text-xs">{r.track_stock ? "se scade" : <span className="text-muted">doar evidență</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={4} className="px-4 py-3 text-sm font-medium">Cost materii prime</td><td className="num px-4 py-3 font-semibold">{ron.format(total)}</td><td /></tr></tfoot>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-ghost" disabled={pending}>Salvează consumul efectiv</button>
          <span className="text-xs text-muted">Opțional — completați doar ce s-a cântărit; restul se consideră conform rețetei.</span>
        </div>
      )}
      <Msg state={state} />
    </form>
  );
}

export function ApproveForm({ orderId }: { orderId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(approveOrder, {});
  return (
    <form action={action} className="space-y-3" onSubmit={(e) => { if (!confirm("Aprobarea actualizează stocurile și blochează documentul. Continuați?")) e.preventDefault(); }}>
      <input type="hidden" name="order_id" value={orderId} />
      <Msg state={state} />
      <button className="btn btn-accent w-full" disabled={pending}>{pending ? "Se actualizează stocurile…" : "Aprobă documentul"}</button>
    </form>
  );
}
