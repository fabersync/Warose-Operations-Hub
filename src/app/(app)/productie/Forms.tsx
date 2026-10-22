"use client";
import { startTransition, useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createOrder, saveRecipe, type FormState } from "./actions";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2, maximumFractionDigits: 4 });

const parse = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}

type Ingredient = { id: number; name: string; unit: string; cost_price: number | null };

export function RecipeEditor({ productId, unit, initial, ingredients, readOnly }: {
  productId: number; unit: string; readOnly: boolean;
  initial: { yield_qty: number; note: string | null; items: { ingredient_id: number; qty: number }[] } | null;
  ingredients: Ingredient[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRecipe, {});
  const [yieldQty, setYield] = useState(initial ? String(initial.yield_qty).replace(".", ",") : "");
  const [rows, setRows] = useState(() =>
    (initial?.items.length ? initial.items : [{ ingredient_id: 0, qty: 0 }]).map((r, i) => ({ key: i, id: r.ingredient_id, qty: r.qty ? String(r.qty).replace(".", ",") : "" })),
  );
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const y = parse(yieldQty);
  const lineCost = (r: { id: number; qty: string }) => { const ing = byId.get(r.id); const q = parse(r.qty); return ing?.cost_price != null && q != null ? ing.cost_price * q : null; };
  const total = rows.reduce((s, r) => s + (lineCost(r) ?? 0), 0);
  const missing = rows.filter((r) => r.id && byId.get(r.id)?.cost_price == null).length;

  return (
    <form
      className="space-y-5"
      // Trimitere manuală: cu action={} React golește formularul după salvare, iar listele controlate ar apărea goale.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="product_id" value={productId} />
      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="field">
          <label className="label" htmlFor="yield_qty">Randament ({unit})</label>
          <input id="yield_qty" name="yield_qty" value={yieldQty} onChange={(e) => setYield(e.target.value)} inputMode="decimal" className="input" placeholder="ex: 50" disabled={readOnly} />
          <p className="text-xs text-muted">Câte {unit} rezultă din cantitățile de mai jos.</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="note">Observații versiune</label>
          <input id="note" name="note" defaultValue={initial?.note ?? ""} className="input" placeholder="ex: aluat cu unt 82%, coacere 18 min" disabled={readOnly} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="table">
          <thead><tr><th>Materie primă</th><th className="num">Cantitate</th><th className="num">Preț unitar</th><th className="num">Cost</th><th className="num">Pe {unit}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, idx) => {
              const ing = byId.get(r.id);
              const c = lineCost(r);
              return (
                <tr key={r.key}>
                  <td className="min-w-[220px]">
                    <select name="ingredient_id" value={r.id || ""} disabled={readOnly} aria-label="Materie primă"
                      onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, id: Number(e.target.value) } : x)))} className="input py-1.5">
                      <option value="">Alegeți…</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <div className="flex items-center justify-end gap-1.5">
                      <input name="qty" value={r.qty} inputMode="decimal" disabled={readOnly} aria-label="Cantitate"
                        onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} className="input w-24 py-1.5 text-right" />
                      <span className="w-8 text-left text-xs text-muted">{ing?.unit ?? ""}</span>
                    </div>
                  </td>
                  <td className="num text-xs">{ing ? (ing.cost_price != null ? ron.format(ing.cost_price) : <span className="text-warn">fără preț</span>) : "—"}</td>
                  <td className="num">{c != null ? ron.format(c) : "—"}</td>
                  <td className="num text-xs text-muted">{c != null && y ? ron.format(c / y) : "—"}</td>
                  <td>
                    {!readOnly && rows.length > 1 && (
                      <button type="button" onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-bad" aria-label="Elimină rândul"><Trash2 className="size-4" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="px-4 py-3 text-sm font-medium text-ink">
                Cost teoretic
                {missing > 0 && <span className="ml-2 text-xs font-normal text-warn">incomplet: {missing} materii prime fără preț</span>}
              </td>
              <td className="num px-4 py-3 font-medium">{ron.format(total)}</td>
              <td className="num px-4 py-3 font-semibold text-ink">{y ? ron.format(total / y) : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setRows((s) => [...s, { key: Date.now(), id: 0, qty: "" }])} className="btn btn-ghost"><Plus className="size-4" />Materie primă</button>
          <button className="btn btn-primary" disabled={pending}>{pending ? "Se salvează…" : initial ? "Salvează ca versiune nouă" : "Salvează rețeta"}</button>
        </div>
      )}
      <Msg state={state} />
    </form>
  );
}

type Product = { id: number; name: string; unit: string; has_recipe: boolean };

export function PlanForm({ products, locations, freezers, defaultDate }: {
  products: Product[]; locations: { id: number; name: string }[]; freezers: { id: number; name: string }[]; defaultDate: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const [rows, setRows] = useState([{ key: 0, id: 0, qty: "" }]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const noRecipe = rows.filter((r) => r.id && !byId.get(r.id)?.has_recipe).length;

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field"><label className="label" htmlFor="planned_for">Data producției</label><input id="planned_for" name="planned_for" type="date" defaultValue={defaultDate} className="input" required /></div>
        <div className="field">
          <label className="label" htmlFor="location_id">Se produce în</label>
          <select id="location_id" name="location_id" className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
        <div className="field">
          <label className="label" htmlFor="freezer_location_id">Congelare în</label>
          <select id="freezer_location_id" name="freezer_location_id" className="input">
            {freezers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="">— fără congelare —</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <div className="label">Produse planificate</div>
        {rows.map((r, idx) => (
          <div key={r.key} className="flex gap-2">
            <select name="product_id" value={r.id || ""} aria-label="Produs" className="input min-w-0 flex-1"
              onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, id: Number(e.target.value) } : x)))}>
              <option value="">Alegeți produsul…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.has_recipe ? "" : " (fără rețetă)"}</option>)}
            </select>
            <input name="planned_qty" value={r.qty} inputMode="decimal" placeholder="cant." aria-label="Cantitate" className="input w-24 text-right"
              onChange={(e) => setRows((s) => s.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
            <span className="flex w-8 items-center text-xs text-muted">{byId.get(r.id)?.unit ?? ""}</span>
            <button type="button" disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="rounded-md p-2 text-muted hover:bg-canvas hover:text-bad disabled:opacity-30" aria-label="Elimină"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((s) => [...s, { key: Date.now(), id: 0, qty: "" }])} className="btn btn-ghost"><Plus className="size-4" />Produs</button>
      </div>
      {noRecipe > 0 && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{noRecipe} produse nu au rețetă: nu se va calcula necesarul și consumul pentru ele.</p>}
      <div className="field"><label className="label" htmlFor="plan_note">Observații</label><input id="plan_note" name="note" className="input" placeholder="opțional" /></div>
      <Msg state={state} />
      <button className="btn btn-primary w-full sm:w-auto" disabled={pending}>{pending ? "Se creează…" : "Creează planul"}</button>
    </form>
  );
}

