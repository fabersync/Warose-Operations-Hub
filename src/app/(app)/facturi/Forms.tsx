"use client";
import { startTransition, useActionState, useMemo, useState } from "react";
import { CheckCircle2, Copy, Plus, Trash2, UploadCloud, XCircle } from "lucide-react";
import { addCostEntry, cancelInvoice, createManualInvoice, reopenInvoice, saveInvoice, saveRule, uploadEInvoices, type FormState } from "./actions";

const ron = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 4 });
const parse = (s: string) => { const n = Number(s.replace(/\s/g, "").replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

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

export function EInvoiceUpload() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadEInvoices, {});
  const [names, setNames] = useState<string[]>([]);
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-canvas/50 px-4 py-6 text-center hover:border-crust hover:bg-crust-soft/40">
        <UploadCloud className="size-6 text-muted" strokeWidth={1.5} />
        <span className="mt-2 text-sm font-medium text-ink">{names.length ? names.join(", ") : "Alegeți facturile e-Factura"}</span>
        <span className="mt-0.5 text-xs text-muted">XML sau ZIP descărcate din SPV · mai multe odată</span>
        <input type="file" name="files" multiple accept=".xml,.zip" className="sr-only" onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name))} />
      </label>
      <button className="btn btn-primary w-full" disabled={pending || !names.length}>{pending ? "Se importă…" : "Importă"}</button>
      <Msg state={state} />
      {state.results?.map((r) => (
        <div key={r.fileName + r.message} className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${r.status === "imported" ? "bg-good-soft" : r.status === "duplicate" ? "bg-canvas" : "bg-bad-soft"}`}>
          {r.status === "imported" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : r.status === "duplicate" ? <Copy className="mt-0.5 size-4 shrink-0 text-muted" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
          <span className="text-ink-2"><b className="text-ink">{r.fileName}</b> — {r.status === "duplicate" ? "dublură blocată: " : ""}{r.message}
            {r.invoiceId && r.status !== "error" && <> · <a href={`/facturi/${r.invoiceId}`} className="font-medium text-crust">deschide</a></>}</span>
        </div>
      ))}
    </form>
  );
}

export function ManualInvoiceForm({ suppliers }: { suppliers: { id: number; name: string; cif: string | null }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createManualInvoice, {});
  const [supplier, setSupplier] = useState("");
  const [rows, setRows] = useState([{ key: 0, d: "", qty: "", unit: "buc", price: "", vat: "21" }]);
  const totals = rows.reduce((s, r) => {
    const net = (parse(r.qty) ?? 0) * (parse(r.price) ?? 0);
    return { net: s.net + net, vat: s.vat + (net * (parse(r.vat) ?? 0)) / 100 };
  }, { net: 0, vat: 0 });
  const set = (i: number, k: string, v: string) => setRows((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <form onSubmit={submitKeep(action)} className="space-y-5" encType="multipart/form-data">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="supplier_id">Furnizor</label>
          <select id="supplier_id" name="supplier_id" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="input">
            <option value="">— furnizor nou —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.cif ? ` (${s.cif})` : ""}</option>)}
          </select>
        </div>
        {!supplier && (
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <div className="field"><label className="label" htmlFor="supplier_name">Nume furnizor nou</label><input id="supplier_name" name="supplier_name" className="input" /></div>
            <div className="field"><label className="label" htmlFor="supplier_cif">CIF</label><input id="supplier_cif" name="supplier_cif" className="input" placeholder="opțional" /></div>
          </div>
        )}
        <div className="field"><label className="label" htmlFor="number">Număr factură</label><input id="number" name="number" required className="input" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="field"><label className="label" htmlFor="issue_date">Data</label><input id="issue_date" name="issue_date" type="date" required className="input" /></div>
          <div className="field"><label className="label" htmlFor="due_date">Scadență</label><input id="due_date" name="due_date" type="date" className="input" /></div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="table">
          <thead><tr><th>Denumire</th><th className="num">Cantitate</th><th>UM</th><th className="num">Preț fără TVA</th><th className="num">TVA %</th><th className="num">Valoare</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="min-w-[200px]"><input name="description" value={r.d} onChange={(e) => set(i, "d", e.target.value)} className="input py-1.5" aria-label="Denumire" /></td>
                <td><input name="qty" value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" className="input w-20 py-1.5 text-right" aria-label="Cantitate" /></td>
                <td><input name="unit" value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} className="input w-16 py-1.5" aria-label="UM" /></td>
                <td><input name="unit_price" value={r.price} onChange={(e) => set(i, "price", e.target.value)} inputMode="decimal" className="input w-24 py-1.5 text-right" aria-label="Preț" /></td>
                <td><input name="vat_rate" value={r.vat} onChange={(e) => set(i, "vat", e.target.value)} inputMode="decimal" className="input w-16 py-1.5 text-right" aria-label="TVA" /></td>
                <td className="num">{ron.format((parse(r.qty) ?? 0) * (parse(r.price) ?? 0))}</td>
                <td><button type="button" disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:text-bad disabled:opacity-30" aria-label="Elimină"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5} className="px-4 py-3 text-right text-sm text-muted">Fără TVA {ron.format(totals.net)} · TVA {ron.format(totals.vat)} · Total</td><td className="num px-4 py-3 font-semibold">{ron.format(totals.net + totals.vat)}</td><td /></tr></tfoot>
        </table>
      </div>
      <button type="button" onClick={() => setRows((s) => [...s, { key: Date.now(), d: "", qty: "", unit: "buc", price: "", vat: "21" }])} className="btn btn-ghost"><Plus className="size-4" />Linie</button>
      <div className="field"><label className="label" htmlFor="pdf">Factura PDF / poză (opțional)</label><input id="pdf" name="pdf" type="file" accept=".pdf,image/*" className="text-sm" /></div>
      <Msg state={state} />
      <button className="btn btn-primary" disabled={pending}>{pending ? "Se salvează…" : "Salvează pentru verificare"}</button>
    </form>
  );
}

type Opt = { id: number; name: string };
type Line = { id: number; description: string; supplier_code: string | null; qty: number; unit: string | null; unit_price: number | null; net: number; vat_rate: number | null;
  product_id: number | null; factor: number; category_id: number | null; to_stock: boolean; prev_cost: number | null; gross_unit_price?: number | null; discount?: number | null };

/** Ecranul de verificare: asocierea liniilor cu materii prime, categorii, alocare, recepție. */
export function VerifyForm({ invoice, lines, products, categories, rules, locations, receiptLocations, editable }: {
  invoice: { id: number; category_id: number | null; rule_id: number | null; allocation_location_id: number | null; receipt_location_id: number | null; note: string | null; total_net: number };
  lines: Line[]; products: (Opt & { unit: string; track_stock: boolean })[]; categories: Opt[]; rules: Opt[]; locations: Opt[]; receiptLocations: Opt[]; editable: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveInvoice, {});
  const [rows, setRows] = useState(() => lines.map((l) => ({ ...l, factorText: String(l.factor).replace(".", ",") })));
  const [alloc, setAlloc] = useState(invoice.rule_id ? `r${invoice.rule_id}` : invoice.allocation_location_id ? `l${invoice.allocation_location_id}` : "");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sumNet = rows.reduce((s, r) => s + r.net, 0);
  const totalOk = Math.abs(sumNet - invoice.total_net) <= 0.05;
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form onSubmit={submitKeep(action)} className="space-y-5">
      <input type="hidden" name="invoice_id" value={invoice.id} />
      <input type="hidden" name="rule_id" value={alloc.startsWith("r") ? alloc.slice(1) : ""} />
      <input type="hidden" name="allocation_location_id" value={alloc.startsWith("l") ? alloc.slice(1) : ""} />
      <fieldset disabled={!editable} className="min-w-0 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="category_id">Categorie cost (implicită)</label>
            <select id="category_id" name="category_id" defaultValue={invoice.category_id ?? ""} className="input">
              <option value="">— alegeți —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="alloc">Alocare pe locații</label>
            <select id="alloc" value={alloc} onChange={(e) => setAlloc(e.target.value)} className="input">
              <option value="">— alegeți —</option>
              <optgroup label="O singură locație">{locations.map((l) => <option key={l.id} value={`l${l.id}`}>{l.name}</option>)}</optgroup>
              {rules.length > 0 && <optgroup label="Reguli de împărțire">{rules.map((r) => <option key={r.id} value={`r${r.id}`}>{r.name}</option>)}</optgroup>}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="receipt_location_id">Recepție marfă în</label>
            <select id="receipt_location_id" name="receipt_location_id" defaultValue={invoice.receipt_location_id ?? ""} className="input">
              <option value="">— fără recepție în stoc —</option>
              {receiptLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="table">
            <thead><tr><th>Linie factură</th><th className="num">Valoare</th><th>Materie primă / produs</th><th className="num">Conversie</th><th className="num">Preț / UM bază</th><th>Categorie</th><th>Stoc</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const p = r.product_id ? byId.get(r.product_id) : null;
                const factor = parse(r.factorText) ?? 1;
                const unitCost = r.product_id && r.qty ? r.net / (r.qty * factor) : null;
                const change = unitCost != null && r.prev_cost ? ((unitCost - r.prev_cost) / r.prev_cost) * 100 : null;
                return (
                  <tr key={r.id}>
                    <td className="min-w-[200px]">
                      <input type="hidden" name="line_id" value={r.id} />
                      <div className="font-medium text-ink">{r.description}</div>
                      <div className="text-xs text-muted">{fmt.format(r.qty)} {r.unit ?? ""} × {r.unit_price != null ? ron.format(r.unit_price) : "—"}{r.supplier_code && ` · cod ${r.supplier_code}`}{r.vat_rate != null && ` · TVA ${r.vat_rate}%`}</div>
                      {r.discount ? <div className="text-xs text-good">reducere {ron.format(r.discount)}{r.gross_unit_price != null && ` (preț brut ${ron.format(r.gross_unit_price)})`}</div> : null}
                    </td>
                    <td className="num">{ron.format(r.net)}</td>
                    <td className="min-w-[200px]">
                      <select name="product_id" value={r.product_id ?? ""} aria-label={`Produs pentru ${r.description}`} className="input py-1.5"
                        onChange={(e) => { const id = Number(e.target.value) || null; set(i, { product_id: id, to_stock: id ? !!byId.get(id)?.track_stock : false }); }}>
                        <option value="">— doar cost (fără produs) —</option>
                        {products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <div className="flex items-center justify-end gap-1 text-xs text-muted">
                        1 {r.unit ?? "UM"} =
                        <input name="factor" value={r.factorText} onChange={(e) => set(i, { factorText: e.target.value })} inputMode="decimal" aria-label="Factor de conversie" className="input w-16 py-1 text-right" />
                        {p?.unit ?? ""}
                      </div>
                    </td>
                    <td className="num text-xs">
                      {unitCost != null ? <>{ron.format(unitCost)}/{p?.unit}{change != null && Math.abs(change) >= 0.5 && <div className={change > 0 ? "text-bad" : "text-good"}>{change > 0 ? "+" : ""}{change.toFixed(1)}% față de anterior</div>}</> : "—"}
                    </td>
                    <td>
                      <select name="line_category_id" defaultValue={r.category_id ?? ""} aria-label="Categorie linie" className="input py-1.5 text-xs">
                        <option value="">= implicită</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" name="to_stock" value={r.id} checked={r.to_stock} disabled={!r.product_id} onChange={(e) => set(i, { to_stock: e.target.checked })} className="accent-crust" aria-label="Intră în stoc" /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">Total linii</td>
                <td className="num px-4 py-3 font-semibold">{ron.format(sumNet)}</td>
                <td colSpan={5} className={`px-4 py-3 text-xs ${totalOk ? "text-good" : "text-bad"}`}>{totalOk ? "corespunde totalului facturii" : `diferă de totalul facturii (${ron.format(invoice.total_net)})`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="field"><label className="label" htmlFor="note">Observații</label><input id="note" name="note" defaultValue={invoice.note ?? ""} className="input" /></div>
      </fieldset>
      <Msg state={state} />
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button name="verify" value="1" className="btn btn-accent" disabled={pending}>{pending ? "Se înregistrează…" : "Verifică și înregistrează"}</button>
          <button className="btn btn-ghost" disabled={pending}>Salvează fără verificare</button>
        </div>
      )}
    </form>
  );
}

export function ReopenForm({ invoiceId }: { invoiceId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reopenInvoice, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <Msg state={state} />
      <button className="btn btn-ghost w-full" disabled={pending}>Redeschide pentru corecții</button>
    </form>
  );
}

export function CancelInvoiceForm({ invoiceId }: { invoiceId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelInvoice, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-2">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input name="reason" required placeholder="Motivul anulării (ex: introdusă greșit)" aria-label="Motivul anulării" className="input" />
      <Msg state={state} />
      <button className="btn btn-danger w-full" disabled={pending}>Anulează factura</button>
    </form>
  );
}

export function CostEntryForm({ categories, locations, rules, defaultDate }: { categories: Opt[]; locations: Opt[]; rules: Opt[]; defaultDate: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addCostEntry, {});
  const [alloc, setAlloc] = useState(locations[0] ? `l${locations[0].id}` : "");
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <input type="hidden" name="rule_id" value={alloc.startsWith("r") ? alloc.slice(1) : ""} />
      <input type="hidden" name="location_id" value={alloc.startsWith("l") ? alloc.slice(1) : ""} />
      <div className="grid grid-cols-2 gap-2">
        <div className="field"><label className="label" htmlFor="ce_date">Data</label><input id="ce_date" name="entry_date" type="date" defaultValue={defaultDate} className="input" /></div>
        <div className="field"><label className="label" htmlFor="ce_amount">Sumă fără TVA</label><input id="ce_amount" name="amount_net" inputMode="decimal" className="input text-right" /></div>
      </div>
      <div className="field">
        <label className="label" htmlFor="ce_cat">Categorie</label>
        <select id="ce_cat" name="category_id" className="input">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="field">
        <label className="label" htmlFor="ce_alloc">Locație / alocare</label>
        <select id="ce_alloc" value={alloc} onChange={(e) => setAlloc(e.target.value)} className="input">
          <optgroup label="O singură locație">{locations.map((l) => <option key={l.id} value={`l${l.id}`}>{l.name}</option>)}</optgroup>
          {rules.length > 0 && <optgroup label="Reguli">{rules.map((r) => <option key={r.id} value={`r${r.id}`}>{r.name}</option>)}</optgroup>}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="field"><label className="label" htmlFor="ce_sup">Furnizor / beneficiar</label><input id="ce_sup" name="supplier" className="input" placeholder="ex: proprietar" /></div>
        <div className="field"><label className="label" htmlFor="ce_desc">Comentariu</label><input id="ce_desc" name="description" className="input" placeholder="ex: chirie octombrie" /></div>
      </div>
      <Msg state={state} />
      <button className="btn btn-primary w-full" disabled={pending}>Adaugă cost</button>
    </form>
  );
}

export function RuleForm({ locations }: { locations: Opt[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRule, {});
  return (
    <form onSubmit={submitKeep(action)} className="space-y-3">
      <div className="field"><label className="label" htmlFor="rule_name">Nume regulă</label><input id="rule_name" name="name" className="input" placeholder="ex: Utilități comune 50/50" /></div>
      <div className="space-y-1.5">
        {locations.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
            <input type="hidden" name="location_id" value={l.id} />
            <span className="text-ink-2">{l.name}</span>
            <span className="flex items-center gap-1"><input name="pct" inputMode="decimal" placeholder="0" aria-label={`Procent ${l.name}`} className="input w-20 py-1 text-right" />%</span>
          </div>
        ))}
      </div>
      <Msg state={state} />
      <button className="btn btn-ghost w-full" disabled={pending}>Salvează regula</button>
    </form>
  );
}
