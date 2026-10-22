"use client";
import { startTransition, useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addComment, cancelOrder, confirmOrder, planFromShortage, receiveOrder, saveOrder, shipOrder, startPreparing, submitOrder, type FormState } from "./actions";

const fmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 3 });
const str = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}

/** Trimitere fără resetarea automată a formularului; păstrează butonul apăsat (ex: „Trimite”). */
function submitKeep(action: (d: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };
}

type Opt = { id: number; name: string };

export function OrderForm({ fromLocations, toLocations, products, initial }: {
  fromLocations: Opt[]; toLocations: Opt[]; products: (Opt & { unit: string })[];
  initial: { order_id?: number; from: number; to: number; needed_for: string; note: string | null; lines: { product_id: number; qty: number }[] };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveOrder, {});
  const [rows, setRows] = useState(() => (initial.lines.length ? initial.lines : [{ product_id: 0, qty: 0 }]).map((l, i) => ({ key: i, id: l.product_id, qty: str(l.qty || null) })));
  const unit = (id: number) => products.find((p) => p.id === id)?.unit ?? "";
  return (
    <form onSubmit={submitKeep(action)} className="space-y-5">
      {initial.order_id && <input type="hidden" name="order_id" value={initial.order_id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="from_location_id">Locația care comandă</label>
          <select id="from_location_id" name="from_location_id" defaultValue={initial.from} className="input">{fromLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
        <div className="field">
          <label className="label" htmlFor="to_location_id">Se livrează din</label>
          <select id="to_location_id" name="to_location_id" defaultValue={initial.to} className="input">{toLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
        <div className="field">
          <label className="label" htmlFor="needed_for">Necesar pentru</label>
          <input id="needed_for" name="needed_for" type="date" defaultValue={initial.needed_for} required className="input" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="label">Produse</div>
        {rows.map((r, idx) => (
          <div key={r.key} className="flex gap-2">
            <select name="product_id" value={r.id || ""} aria-label="Produs" className="input min-w-0 flex-1"
              onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, id: Number(e.target.value) } : x)))}>
              <option value="">Alegeți produsul…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input name="qty" value={r.qty} inputMode="decimal" placeholder="cant." aria-label="Cantitate" className="input w-24 text-right"
              onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
            <span className="flex w-8 items-center text-xs text-muted">{unit(r.id)}</span>
            <button type="button" disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="rounded-md p-2 text-muted hover:bg-canvas hover:text-bad disabled:opacity-30" aria-label="Elimină"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((s) => [...s, { key: Date.now(), id: 0, qty: "" }])} className="btn btn-ghost"><Plus className="size-4" />Produs</button>
      </div>
      <div className="field"><label className="label" htmlFor="order_note">Observații</label><input id="order_note" name="note" defaultValue={initial.note ?? ""} className="input" placeholder="opțional" /></div>
      <Msg state={state} />
      <div className="flex flex-wrap gap-2">
        <button name="submit" value="1" className="btn btn-primary" disabled={pending}>Trimite către furnizor</button>
        <button className="btn btn-ghost" disabled={pending}>Salvează ciorna</button>
      </div>
    </form>
  );
}

type StageLine = { id: number; product: string; unit: string; info: React.ReactNode; value: number | null };

/** Formular comun pentru confirmare / expediere / recepție: o cantitate pe linie + un câmp text. */
export function StageForm({ kind, orderId, lines, header }: { kind: "confirm" | "ship" | "receive"; orderId: number; lines: StageLine[]; header: string }) {
  const cfg = {
    confirm: { action: confirmOrder, field: "confirmed_qty", text: "reason", textLabel: "Motivul modificărilor (obligatoriu dacă schimbați cantități)", button: "Confirmă comanda" },
    ship: { action: shipOrder, field: "shipped_qty", text: null, textLabel: "", button: "Înregistrează expedierea" },
    receive: { action: receiveOrder, field: "received_qty", text: "note", textLabel: "Observații recepție (obligatoriu la diferențe)", button: "Confirmă recepția" },
  }[kind];
  const [state, action, pending] = useActionState<FormState, FormData>(cfg.action, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Produs</th><th>Detalii</th><th className="num">{header}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="font-medium text-ink"><input type="hidden" name="line_id" value={l.id} />{l.product}</td>
                <td className="text-xs text-muted">{l.info}</td>
                <td className="num">
                  <div className="flex items-center justify-end gap-1.5">
                    <input name={cfg.field} defaultValue={str(l.value)} inputMode="decimal" required aria-label={`${header} ${l.product}`} className="input w-24 py-1.5 text-right" />
                    <span className="w-7 text-left text-xs text-muted">{l.unit}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cfg.text && <div className="field"><label className="label" htmlFor={`${kind}_text`}>{cfg.textLabel}</label><input id={`${kind}_text`} name={cfg.text} className="input" /></div>}
      <Msg state={state} />
      <button className="btn btn-accent" disabled={pending}>{pending ? "Se înregistrează…" : cfg.button}</button>
    </form>
  );
}

export function SimpleAction({ kind, orderId, label, danger }: { kind: "submit" | "prepare"; orderId: number; label: string; danger?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(kind === "submit" ? submitOrder : startPreparing, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      <Msg state={state} />
      <button className={`btn w-full ${danger ? "btn-danger" : "btn-primary"}`} disabled={pending}>{label}</button>
    </form>
  );
}

export function CancelForm({ orderId, needsReason }: { orderId: number; needsReason: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelOrder, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="btn btn-danger w-full">Anulează comanda</button>;
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      {needsReason && <input name="reason" required placeholder="Motivul anulării" aria-label="Motivul anulării" className="input" />}
      <Msg state={state} />
      <button className="btn btn-danger w-full" disabled={pending}>Confirmă anularea</button>
    </form>
  );
}

export function CommentForm({ orderId }: { orderId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addComment, {});
  return (
    <form onSubmit={(e) => { submitKeep(action)(e); e.currentTarget.reset(); }} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      <div className="flex gap-2">
        <input name="comment" placeholder="Scrieți un comentariu…" aria-label="Comentariu" className="input min-w-0 flex-1" />
        <button className="btn btn-ghost" disabled={pending}>Trimite</button>
      </div>
      {state.error && <Msg state={state} />}
    </form>
  );
}

export function ShortagePlanForm({ freezerId, defaultDate, rows }: { freezerId: number | null; defaultDate: string; rows: { product_id: number; product: string; unit: string; qty: number }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(planFromShortage, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      {freezerId && <input type="hidden" name="freezer_location_id" value={freezerId} />}
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.product_id} className="flex items-center justify-between gap-2">
            <input type="hidden" name="product_id" value={r.product_id} />
            <span className="min-w-0 truncate text-ink-2">{r.product}</span>
            <span className="flex items-center gap-1.5">
              <input name="qty" defaultValue={Math.ceil(r.qty)} inputMode="numeric" aria-label={`Cantitate ${r.product}`} className="input w-20 py-1 text-right" />
              <span className="w-7 text-xs text-muted">{r.unit}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <label className="label shrink-0" htmlFor="sp_date">Produce la</label>
        <input id="sp_date" name="planned_for" type="date" defaultValue={defaultDate} className="input py-1.5" />
      </div>
      <Msg state={state} />
      <button className="btn btn-primary w-full" disabled={pending}>Creează plan de producție</button>
      <p className="text-xs text-muted">Se creează un plan în BRUTĂRIE, cu congelare în acest depozit; necesarul de materii prime se vede în plan. Produsele fără rețetă intră fără calcul de consum.</p>
    </form>
  );
}
