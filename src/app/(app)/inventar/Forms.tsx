"use client";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { closeInventory, saveCount, startInventory, type StartState } from "./actions";

const num = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 3 });

export function StartForm({ locations, defaultAsOf }: { locations: { id: number; name: string }[]; defaultAsOf: string }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startInventory, {});
  return (
    <form action={action} className="space-y-3">
      <div className="field">
        <label className="label" htmlFor="inv_loc">Locația</label>
        <select id="inv_loc" name="location_id" className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <div className="field">
        <label className="label" htmlFor="as_of">Inventarul se referă la</label>
        <input id="as_of" name="as_of" type="datetime-local" defaultValue={defaultAsOf} required className="input" />
        <p className="text-xs text-muted">De obicei ora închiderii. Vânzările de după acest moment nu intră în stocul scriptic.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="inv_note">Observații</label>
        <input id="inv_note" name="note" placeholder="ex: inventar lunar octombrie" className="input" />
      </div>
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Se pregătește lista…" : "Începe inventarul"}</button>
    </form>
  );
}

type Line = { id: number; product: string; unit: string; book_qty: number; counted_qty: number | null; counted_by: string | null };

/** Fișa de numărare: gândită pentru telefon — căutare, câmpuri mari, salvare automată la fiecare produs. */
export function CountSheet({ lines, showBook }: { lines: Line[]; showBook: boolean }) {
  const [filter, setFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [values, setValues] = useState<Record<number, number | null>>(() => Object.fromEntries(lines.map((l) => [l.id, l.counted_qty])));
  // Liniile adăugate după încărcare (produs găsit în plus) nu sunt încă în starea locală.
  const get = (l: Line) => (l.id in values ? values[l.id] : l.counted_qty);
  const counted = lines.filter((l) => get(l) !== null).length;
  const shown = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return lines.filter((l) => (!f || l.product.includes(f)) && (!onlyMissing || get(l) === null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, filter, onlyMissing, values]);

  return (
    <div>
      <div className="sticky top-[57px] z-10 -mx-5 border-b border-line bg-surface/95 px-5 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>{counted} din {lines.length} produse numărate</span>
          <span className="tabular-nums">{lines.length ? Math.round((counted / lines.length) * 100) : 0}%</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-good transition-all" style={{ width: `${lines.length ? (counted / lines.length) * 100 : 0}%` }} /></div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Caută produsul…" className="input pl-9" aria-label="Caută produsul" />
          </div>
          <button type="button" onClick={() => setOnlyMissing((v) => !v)} className={`btn ${onlyMissing ? "btn-primary" : "btn-ghost"}`}>Nenumărate</button>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((l) => (
          <CountRow key={l.id} line={l} showBook={showBook} value={get(l)} onSaved={(v) => setValues((s) => ({ ...s, [l.id]: v }))} />
        ))}
        {!shown.length && <li className="py-8 text-center text-sm text-muted">Niciun produs nu corespunde filtrului.</li>}
      </ul>
    </div>
  );
}

function CountRow({ line, showBook, value, onSaved }: { line: Line; showBook: boolean; value: number | null; onSaved: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const last = useRef(text);
  const diff = value !== null ? value - line.book_qty : null;

  const commit = () => {
    if (text === last.current) return;
    start(async () => {
      const r = await saveCount(line.id, text);
      if (r.ok) { last.current = text; setError(null); onSaved(r.value ?? null); }
      else setError(r.error ?? "Eroare la salvare");
    });
  };

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink" title={line.product}>{line.product}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {showBook && <span>scriptic {num.format(line.book_qty)} {line.unit}</span>}
          {showBook && diff !== null && Math.abs(diff) > 1e-9 && <span className={diff < 0 ? "text-bad" : "text-good"}>{diff > 0 ? "+" : ""}{num.format(diff)}</span>}
          {error && <span className="text-bad">{error}</span>}
        </div>
      </div>
      <div className="relative w-28 shrink-0">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          inputMode="decimal"
          placeholder="—"
          aria-label={`Cantitate numărată ${line.product}`}
          className={`input pr-14 text-right text-base tabular-nums ${value !== null ? "border-good/40 bg-good-soft/40" : ""}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-muted">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : value !== null ? <Check className="size-3.5 text-good" /> : null}
          {line.unit}
        </span>
      </div>
    </li>
  );
}

export function CloseForm({ countId, uncounted }: { countId: number; uncounted: number }) {
  const [state, action, pending] = useActionState<StartState, FormData>(closeInventory, {});
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (!confirm("Închiderea înregistrează diferențele în stoc și nu mai poate fi modificată. Continuați?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="count_id" value={countId} />
      {uncounted > 0 && (
        <label className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-ink-2">
          <input type="checkbox" name="zero_uncounted" className="mt-0.5 accent-crust" />
          <span>Cele <strong>{uncounted}</strong> produse nenumărate au stoc faptic 0. <span className="text-muted">Altfel, rămân neschimbate.</span></span>
        </label>
      )}
      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      <button className="btn btn-accent w-full" disabled={pending}>{pending ? "Se înregistrează diferențele…" : "Închide inventarul"}</button>
    </form>
  );
}
