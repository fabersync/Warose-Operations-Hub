"use client";
import { startTransition, useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createSupplier, deliverPurchaseOrder, savePurchaseOrder, saveTargets, sendPurchaseOrder, type FormState } from "./actions";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2 });
const parse = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };
const str = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}
function submitKeep(action: (d: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };
}

type Product = { id: number; name: string; unit: string; cost_price: number | null };
type Opt = { id: number; name: string };

export function PurchaseOrderForm({ locations, suppliers, products, initial }: {
  locations: Opt[]; suppliers: Opt[]; products: Product[];
  initial: { order_id?: number; location_id: number; supplier_id: number | null; needed_for: string; note: string | null; lines: { product_id: number; qty: number }[] };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePurchaseOrder, {});
  const [rows, setRows] = useState(() => (initial.lines.length ? initial.lines : [{ product_id: 0, qty: 0 }]).map((l, i) => ({ key: i, id: l.product_id, qty: str(l.qty || null) })));
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const total = rows.reduce((s, r) => s + (parse(r.qty) ?? 0) * (byId.get(r.id)?.cost_price ?? 0), 0);
  return (
    <form onSubmit={submitKeep(action)} className="space-y-5">
      {initial.order_id && <input type="hidden" name="order_id" value={initial.order_id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field"><label className="label" htmlFor="location_id">Livrare la</label>
          <select id="location_id" name="location_id" defaultValue={initial.location_id} className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="supplier_id">Furnizor</label>
          <select id="supplier_id" name="supplier_id" defaultValue={initial.supplier_id ?? ""} required className="input">
            <option value="" disabled>Alegeți furnizorul…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="needed_for">Data dorită</label><input id="needed_for" name="needed_for" type="date" defaultValue={initial.needed_for} className="input" /></div>
      </div>
      <div className="space-y-2">
        <div className="label">Produse</div>
        {rows.map((r, idx) => {
          const p = byId.get(r.id);
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <select name="product_id" value={r.id || ""} aria-label="Produs" className="input min-w-0 flex-1"
                onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, id: Number(e.target.value) } : x)))}>
                <option value="">Alegeți produsul…</option>
                {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <input name="qty" value={r.qty} inputMode="decimal" placeholder="cant." aria-label="Cantitate" className="input w-24 text-right"
                onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
              <span className="w-8 text-xs text-muted">{p?.unit ?? ""}</span>
              <span className="w-28 text-right text-xs text-muted tabular-nums">{p?.cost_price != null && parse(r.qty) ? ron.format(p.cost_price * parse(r.qty)!) : "—"}</span>
              <button type="button" disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="rounded-md p-2 text-muted hover:text-bad disabled:opacity-30" aria-label="Elimină"><Trash2 className="size-4" /></button>
            </div>
          );
        })}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setRows((s) => [...s, { key: Date.now(), id: 0, qty: "" }])} className="btn btn-ghost"><Plus className="size-4" />Produs</button>
          <span className="text-sm text-muted">Estimat (ultimele prețuri, fără TVA): <b className="text-ink">{ron.format(total)}</b></span>
        </div>
      </div>
      <div className="field"><label className="label" htmlFor="po_note">Observații pentru furnizor</label><input id="po_note" name="note" defaultValue={initial.note ?? ""} className="input" placeholder="ex: livrare dimineața, până la ora 9" /></div>
      <Msg state={state} />
      <button className="btn btn-primary" disabled={pending}>{pending ? "Se salvează…" : "Salvează comanda"}</button>
    </form>
  );
}

export function SendForm({ orderId, hasEmail }: { orderId: number; hasEmail: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendPurchaseOrder, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      <Msg state={state} />
      {hasEmail && <button name="via" value="email" className="btn btn-primary w-full" disabled={pending}>Trimite furnizorului pe email</button>}
      <button name="via" value="manual" className="btn btn-ghost w-full" disabled={pending}>Marchează ca trimisă (telefon / listă / magazin)</button>
    </form>
  );
}

export function DeliverForm({ orderId, lines, invoices }: { orderId: number; lines: { id: number; product: string; unit: string; qty: number }[]; invoices: { id: number; number: string; issue_date: string; total_net: number }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deliverPurchaseOrder, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <input type="hidden" name="order_id" value={orderId} />
      <table className="table">
        <thead><tr><th>Produs</th><th className="num">Comandat</th><th className="num">Primit</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="font-medium text-ink"><input type="hidden" name="line_id" value={l.id} />{l.product}</td>
              <td className="num">{str(l.qty)} {l.unit}</td>
              <td className="num"><input name="received_qty" defaultValue={str(l.qty)} inputMode="decimal" aria-label={`Primit ${l.product}`} className="input w-24 py-1.5 text-right" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="field">
        <label className="label" htmlFor="invoice_id">Factura furnizorului (opțional)</label>
        <select id="invoice_id" name="invoice_id" defaultValue="" className="input">
          <option value="">— fără factură încă —</option>
          {invoices.map((i) => <option key={i.id} value={i.id}>nr. {i.number} din {i.issue_date} · {ron.format(i.total_net)}</option>)}
        </select>
        <p className="text-xs text-muted">Stocul intră în evidență la verificarea facturii, nu aici — ca recepția să nu fie înregistrată de două ori.</p>
      </div>
      <Msg state={state} />
      <button className="btn btn-accent w-full" disabled={pending}>Înregistrează livrarea</button>
    </form>
  );
}

export function SupplierForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSupplier, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <div className="flex gap-2">
        <input name="name" placeholder="Furnizor nou (ex: METRO CASH & CARRY)" aria-label="Nume furnizor" className="input min-w-0 flex-1" />
        <input name="cif" placeholder="CIF" aria-label="CIF" className="input w-28" />
      </div>
      <Msg state={state} />
      <button className="btn btn-ghost w-full" disabled={pending}>Adaugă furnizor</button>
    </form>
  );
}

export function TargetsForm({ locationId, rows }: { locationId: number; rows: { id: number; name: string; unit: string; stock: number; min_qty: number | null; target_qty: number | null }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTargets, {});
  const [filter, setFilter] = useState("");
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <input type="hidden" name="location_id" value={locationId} />
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Caută produsul…" aria-label="Caută" className="input" />
      <div className="max-h-[560px] overflow-auto rounded-xl border border-line">
        <table className="table">
          <thead className="sticky top-0 bg-surface"><tr><th>Produs</th><th className="num">Stoc acum</th><th className="num">Minim</th><th className="num">Țintă</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={filter && !r.name.toUpperCase().includes(filter.toUpperCase()) ? "hidden" : ""}>
                <td className="font-medium text-ink"><input type="hidden" name="product_id" value={r.id} />{r.name}</td>
                <td className={`num ${r.min_qty != null && r.stock < r.min_qty ? "text-bad" : ""}`}>{str(Math.round(r.stock * 1000) / 1000)} {r.unit}</td>
                <td className="num"><input name="min_qty" defaultValue={str(r.min_qty)} inputMode="decimal" aria-label={`Minim ${r.name}`} className="input w-20 py-1 text-right" /></td>
                <td className="num"><input name="target_qty" defaultValue={str(r.target_qty)} inputMode="decimal" aria-label={`Țintă ${r.name}`} className="input w-20 py-1 text-right" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Lăsați gol pentru produsele care nu se urmăresc. Sub minim, produsul apare în propunerile de comandă, cu cantitatea până la țintă.</p>
      <Msg state={state} />
      <button className="btn btn-primary" disabled={pending}>Salvează stocurile minime</button>
    </form>
  );
}
