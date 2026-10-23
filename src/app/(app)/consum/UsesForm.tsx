"use client";
import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { saveUses, type UseState } from "./actions";

type Product = { id: number; name: string; unit: string; cost: number | null; price: number | null };
const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2 });
const parse = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

/** Formularul de sfârșit de zi: lista produselor locației, se completează doar cantitățile consumate / pierdute. */
export function UsesForm({ kind, labels, locations, locationId, today, products }: {
  kind: string; labels: { person: string; personHint: string; reason: string; reasonHint: string };
  locations: { id: number; name: string }[]; locationId: number; today: string; products: Product[];
}) {
  const [state, action, pending] = useActionState<UseState, FormData>(saveUses, {});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(false);
  useEffect(() => { if (state.ok) setQty({}); }, [state.at, state.ok]);

  const filled = useMemo(() => products.filter((p) => parse(qty[p.id] ?? "") != null), [products, qty]);
  const total = filled.reduce((s, p) => s + (p.cost ?? 0) * (parse(qty[p.id])! || 0), 0);
  const visible = products.filter((p) => (!filter || p.name.toUpperCase().includes(filter.toUpperCase())) && (!onlyFilled || qty[p.id]));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        // Se trimit doar produsele completate.
        data.delete("product_id"); data.delete("qty");
        for (const p of filled) { data.append("product_id", String(p.id)); data.append("qty", qty[p.id]); }
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="field"><label className="label" htmlFor="u_loc">Locație</label>
          <select id="u_loc" name="location_id" defaultValue={locationId} className="input"
            onChange={(e) => { const u = new URL(location.href); u.searchParams.set("loc", e.target.value); location.href = u.toString(); }}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></div>
        <div className="field"><label className="label" htmlFor="u_date">Data</label><input id="u_date" name="date" type="date" max={today} defaultValue={today} className="input" /></div>
        <div className="field"><label className="label" htmlFor="u_person">{labels.person}</label><input id="u_person" name="person" placeholder={labels.personHint} className="input" /></div>
        <div className="field"><label className="label" htmlFor="u_reason">{labels.reason}</label><input id="u_reason" name="reason" placeholder={labels.reasonHint} className="input" /></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Caută produsul…" aria-label="Caută produsul" className="input pl-9" />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />Doar completate ({filled.length})</label>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-xl border border-line">
        <table className="table">
          <thead className="sticky top-0 z-10 bg-surface"><tr><th>Produs</th><th className="num">Cantitate</th><th className="num">Cost unitar</th><th className="num">Valoare la cost</th></tr></thead>
          <tbody>
            {visible.map((p) => {
              const v = parse(qty[p.id] ?? "");
              return (
                <tr key={p.id} className={v ? "bg-crust-soft/40" : ""}>
                  <td className="font-medium text-ink">{p.name}</td>
                  <td className="num">
                    <div className="inline-flex items-center gap-1.5">
                      <input value={qty[p.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [p.id]: e.target.value }))} inputMode="decimal"
                        aria-label={`Cantitate ${p.name}`} className="input w-20 py-1 text-right" />
                      <span className="w-7 text-left text-xs text-muted">{p.unit}</span>
                    </div>
                  </td>
                  <td className="num text-muted">{p.cost != null ? ron.format(p.cost) : <span className="text-warn">fără cost</span>}</td>
                  <td className="num">{v && p.cost != null ? ron.format(v * p.cost) : "—"}</td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-muted">Niciun produs găsit.</td></tr>}
          </tbody>
        </table>
      </div>

      {state.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{state.ok}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">{filled.length} produse · total la cost <b className="text-ink">{ron.format(total)}</b></span>
        <button className="btn btn-primary" disabled={pending || !filled.length}>{pending ? "Se salvează…" : "Salvează"}</button>
      </div>
    </form>
  );
}
