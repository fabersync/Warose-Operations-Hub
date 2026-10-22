"use client";
import { startTransition, useActionState, useOptimistic, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { confirmPlan, saveProductProofing, setItem, toggleTask, type FormState } from "./actions";
import type { TaskKind } from "@/lib/proofing";

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>;
  return null;
}

/** Trimitere fără resetarea automată a formularului (React golește formularele cu action={}). */
function submitKeep(action: (d: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
}

export function AddItemForm({ planId, products }: { planId: number; products: { id: number; name: string; configured: boolean }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setItem, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="plan_id" value={planId} />
      <div className="flex gap-2">
        <select name="product_id" required defaultValue="" className="input min-w-0 flex-1" aria-label="Produs">
          <option value="" disabled>Alegeți produsul…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? "" : " (fără durate)"}</option>)}
        </select>
        <input name="qty" inputMode="decimal" required placeholder="cant." aria-label="Cantitate" className="input w-24 text-right" />
        <button className="btn btn-ghost" disabled={pending}>Adaugă</button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function QtyCell({ planId, productId, qty }: { planId: number; productId: number; qty: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setItem, {});
  return (
    <form onSubmit={submitKeep(action)} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="product_id" value={productId} />
      <input name="qty" defaultValue={String(qty).replace(".", ",")} inputMode="decimal" aria-label="Cantitate"
        onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="input w-20 py-1 text-right" />
      {pending && <Loader2 className="size-3.5 animate-spin text-muted" />}
      {state.error && <span className="text-xs text-bad" title={state.error}>!</span>}
    </form>
  );
}

export function ConfirmForm({ planId }: { planId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(confirmPlan, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="plan_id" value={planId} />
      <Msg state={state} />
      <button className="btn btn-accent w-full" disabled={pending}>{pending ? "Se confirmă…" : "Confirmă planul"}</button>
    </form>
  );
}

type Task = { itemId: number; kind: TaskKind; product: string; qty: number; unit: string; time: string; label: string; doneAt: string | null; doneBy: string | null; late: boolean };

/** Lista de sarcini pentru tura de noapte: mare, ușor de bifat de pe telefon sau tabletă. */
export function TaskList({ tasks, interactive }: { tasks: Task[]; interactive: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(tasks, (s, key: string) =>
    s.map((t) => (`${t.itemId}-${t.kind}` === key ? { ...t, doneAt: t.doneAt ? null : new Date().toISOString(), doneBy: t.doneAt ? null : "acum" } : t)));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  let lastTime = "";
  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
      <ol className="space-y-1">
        {optimistic.map((t) => {
          const key = `${t.itemId}-${t.kind}`;
          const showTime = t.time !== lastTime;
          lastTime = t.time;
          const done = !!t.doneAt;
          return (
            <li key={key} className="flex gap-3">
              <div className={`w-[86px] shrink-0 pt-3 text-right text-sm font-semibold tabular-nums ${showTime ? (t.late && !done ? "text-bad" : "text-ink") : "text-transparent"}`}>{t.time}</div>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => start(async () => {
                  setOptimistic(key);
                  const r = await toggleTask(t.itemId, t.kind);
                  setError(r.error ?? null);
                })}
                className={`flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${done ? "border-good/30 bg-good-soft/60" : t.late ? "border-bad/30 bg-bad-soft/40" : "border-line bg-surface hover:border-line-strong"} disabled:cursor-default`}
                aria-pressed={done}
              >
                <span className={`grid size-6 shrink-0 place-items-center rounded-md border ${done ? "border-good bg-good text-white" : "border-line-strong bg-surface"}`}>{done && <Check className="size-4" strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${done ? "text-muted line-through" : "text-ink"}`}>{t.product} · {t.qty} {t.unit}</span>
                  <span className="block text-xs text-muted">{t.label}{done && t.doneBy && ` · bifat de ${t.doneBy}`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ProductConfigForm({ products, initial }: {
  products: { id: number; name: string }[];
  initial?: { product_id: number; thaw: number; proof: number; bake: number; validated: boolean; note: string | null };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProductProofing, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <div className="field">
        <label className="label" htmlFor="pp_product">Produs</label>
        <select id="pp_product" name="product_id" required defaultValue={initial?.product_id ?? ""} className="input">
          <option value="" disabled>Alegeți produsul…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="field"><label className="label" htmlFor="pp_thaw">Decongelare</label><input id="pp_thaw" name="thaw_minutes" inputMode="numeric" defaultValue={initial?.thaw ?? 0} className="input text-right" /></div>
        <div className="field"><label className="label" htmlFor="pp_proof">Dospire *</label><input id="pp_proof" name="proof_minutes" inputMode="numeric" required defaultValue={initial?.proof ?? ""} className="input text-right" /></div>
        <div className="field"><label className="label" htmlFor="pp_bake">Coacere</label><input id="pp_bake" name="bake_minutes" inputMode="numeric" defaultValue={initial?.bake ?? 0} className="input text-right" /></div>
      </div>
      <p className="text-xs text-muted">Minute. Decongelarea 0 = intră direct din congelator în dospitor; coacerea 0 = gata după dospire.</p>
      <div className="field"><label className="label" htmlFor="pp_note">Observații</label><input id="pp_note" name="note" defaultValue={initial?.note ?? ""} className="input" placeholder="ex: dospitor 32°C, 80% umiditate" /></div>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="validated" defaultChecked={initial?.validated} className="accent-crust" />Durate verificate în practică</label>
      <Msg state={state} />
      <button className="btn btn-primary w-full" disabled={pending}>Salvează duratele</button>
    </form>
  );
}
