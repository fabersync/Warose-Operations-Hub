import Link from "next/link";
import { Download, Undo2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtNum, fmtRon, monthStart, todayLocal } from "@/lib/format";
import { listUses, unitCosts, useProducts, USE_KINDS, type UseKind } from "@/lib/internal";
import { locationsFor } from "@/lib/queries";
import { Card, EmptyState, Kpi, PageHeader } from "@/components/ui";
import { UsesForm } from "./UsesForm";
import { cancelUseAction } from "./actions";

export type UsesSP = { loc?: string; from?: string; to?: string; k?: string };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Pagina comună pentru consum personal, protocol și pierderi: formularul zilei, istoricul perioadei și exportul. */
export async function UsesView({ kind, sp, tabs }: { kind: UseKind; sp: UsesSP; tabs?: { kind: UseKind; href: string }[] }) {
  const user = await requireUser("consumption");
  const meta = USE_KINDS[kind];
  const locations = (await locationsFor(user)).filter((l) => l.kind !== "freezer");
  const loc = locations.find((l) => l.id === Number(sp.loc)) ?? locations[0];
  const today = todayLocal();
  let from = isDate(sp.from) ? sp.from! : monthStart(today);
  let to = isDate(sp.to) ? sp.to! : today;
  if (from > to) [from, to] = [to, from];
  const filterLoc = sp.loc === "all" ? null : loc?.id ?? null;

  const [products, rows] = await Promise.all([
    loc ? useProducts(loc.id) : Promise.resolve([]),
    listUses(user, { from, to, locationId: filterLoc, kinds: [kind] }),
  ]);
  const costs = await unitCosts(products.map((p) => p.id));
  const withCost = products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, cost: costs.get(p.id)?.cost ?? null, price: costs.get(p.id)?.price ?? null }));

  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const totalSale = rows.reduce((s, r) => s + (r.sale_value ?? 0), 0);
  const days = new Set(rows.map((r) => r.use_date)).size;
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { qty: number; cost: number; n: number }>();
    for (const r of rows) { const k = key(r); const x = m.get(k) ?? { qty: 0, cost: 0, n: 0 }; x.qty += r.qty; x.cost += r.cost ?? 0; x.n++; m.set(k, x); }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  };
  const byProduct = group((r) => `${r.product}|${r.unit}`).slice(0, 10);
  const byPerson = group((r) => r.person || "—").slice(0, 10);
  const qs = new URLSearchParams({ kind, from, to, ...(filterLoc ? { loc: String(filterLoc) } : {}) });
  const base = kind === "loss" ? "/pierderi" : `/consum${kind === "protocol" ? "?k=protocol&" : "?"}`;
  const href = (extra: Record<string, string>) => `${base}${base.includes("?") ? "" : "?"}${new URLSearchParams({ ...extra }).toString()}`;
  const canCancel = (r: (typeof rows)[number]) => user.role === "admin" || user.role === "location_manager" || user.role === "production" || r.use_date === today;

  return (
    <>
      <PageHeader title={meta.title}
        description={kind === "loss"
          ? "Seara, la închidere, se trec produsele nevândute sau deteriorate. Valoarea se calculează la costul de producție (din rețetă) sau, pentru marfă, la prețul de achiziție. Produsele cu stoc urmărit se scad automat din stoc."
          : "Ce consumă angajații și ce se oferă în protocol, cu valoarea la cost. Produsele cu stoc urmărit (sau ingredientele rețetei, pentru produsele preparate în magazin) se scad automat din stoc."}
        actions={<a href={`/api/export/consum?${qs}`} className="btn btn-ghost"><Download className="size-4" />Export Excel</a>} />

      {tabs && (
        <div className="mb-4 flex gap-1.5">
          {tabs.map((t) => <Link key={t.kind} href={t.href} className={`rounded-md px-3 py-1.5 text-xs font-medium ${t.kind === kind ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{USE_KINDS[t.kind].label}</Link>)}
        </div>
      )}

      {loc ? (
        <Card title={`Înregistrare · ${meta.label.toLowerCase()}`} subtitle="Completați doar produsele care au fost consumate / pierdute. Lista e ordonată după vânzările locației din ultimele 60 de zile.">
          <UsesForm key={`${kind}-${loc.id}`} kind={kind} labels={meta} locations={locations} locationId={loc.id} today={today} products={withCost} />
        </Card>
      ) : <EmptyState title="Nu aveți acces la nicio locație" />}

      <form className="card mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
        {kind === "protocol" && <input type="hidden" name="k" value="protocol" />}
        <div className="field"><label className="label" htmlFor="f_from">De la</label><input id="f_from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div className="field"><label className="label" htmlFor="f_to">Până la</label><input id="f_to" name="to" type="date" defaultValue={to} className="input" /></div>
        <div className="field"><label className="label" htmlFor="f_loc">Locație</label>
          <select id="f_loc" name="loc" defaultValue={sp.loc === "all" ? "all" : loc?.id ?? ""} className="input">
            {locations.length > 1 && <option value="all">Toate locațiile</option>}
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></div>
        <button className="btn btn-ghost">Arată</button>
      </form>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Kpi label={`Valoare la cost · ${fmtDate(from).slice(0, 6)} – ${fmtDate(to).slice(0, 6)}`} value={fmtRon(totalCost, true)} hint={<span>{rows.length} înregistrări în {days} zile</span>} />
        <Kpi label="Valoare la preț de vânzare (fără TVA)" value={fmtRon(totalSale, true)} hint={<span>cât ar fi adus dacă s-ar fi vândut</span>} />
        <Kpi label="Medie pe zi (la cost)" value={fmtRon(days ? totalCost / days : 0, true)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Pe produs" subtitle="Cele mai mari valori din perioadă" pad={false}>
          {byProduct.length ? (
            <table className="table"><thead><tr><th>Produs</th><th className="num">Cantitate</th><th className="num">La cost</th></tr></thead>
              <tbody>{byProduct.map(([k, v]) => { const [name, unit] = k.split("|"); return <tr key={k}><td className="font-medium text-ink">{name}</td><td className="num">{fmtNum(v.qty)} {unit}</td><td className="num">{fmtRon(v.cost, true)}</td></tr>; })}</tbody></table>
          ) : <EmptyState title="Nimic înregistrat în perioadă" />}
        </Card>
        <Card title={`Pe ${meta.person.toLowerCase()}`} pad={false}>
          {byPerson.length ? (
            <table className="table"><thead><tr><th>{meta.person}</th><th className="num">Înregistrări</th><th className="num">La cost</th></tr></thead>
              <tbody>{byPerson.map(([k, v]) => <tr key={k}><td className="font-medium text-ink">{k}</td><td className="num">{v.n}</td><td className="num">{fmtRon(v.cost, true)}</td></tr>)}</tbody></table>
          ) : <EmptyState title="Nimic înregistrat în perioadă" />}
        </Card>
      </div>

      <Card className="mt-4" title="Istoric" subtitle={`${fmtDate(from)} – ${fmtDate(to)}`} pad={false}>
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Data</th><th>Locație</th><th>Produs</th><th className="num">Cant.</th><th className="num">Cost unitar</th><th className="num">La cost</th><th>{meta.person}</th><th>{meta.reason}</th><th>Introdus de</th><th></th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(r.use_date)}</td>
                  <td className="text-xs">{r.location.replace("Warose Bakery ", "")}</td>
                  <td className="font-medium text-ink">{r.product}</td>
                  <td className="num">{fmtNum(r.qty)} {r.unit}</td>
                  <td className="num text-muted" title={r.cost_source === "recipe" ? "cost de producție din rețetă" : r.cost_source === "purchase" ? "preț de achiziție" : "fără cost"}>{r.unit_cost != null ? fmtRon(r.unit_cost, true) : "—"}</td>
                  <td className="num">{r.cost != null ? fmtRon(r.cost, true) : "—"}</td>
                  <td className="text-xs">{r.person ?? "—"}</td>
                  <td className="max-w-[200px] truncate text-xs" title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                  <td className="text-xs text-muted">{r.author}</td>
                  <td>{canCancel(r) && (
                    <form action={cancelUseAction}><input type="hidden" name="use_id" value={r.id} /><button className="rounded-md p-1.5 text-muted hover:text-bad" title="Anulează înregistrarea (mișcările de stoc se stornează)" aria-label="Anulează"><Undo2 className="size-4" /></button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="Nicio înregistrare în perioadă" />}
        {rows.length > 500 && <p className="px-6 py-3 text-xs text-muted">Se afișează primele 500 de rânduri; exportul Excel le conține pe toate.</p>}
      </Card>
      {/* legături rapide pentru filtrul perioadei */}
      <div className="mt-3 flex gap-3 text-xs text-muted">
        <Link href={href({ from: monthStart(today), to: today, ...(filterLoc ? { loc: String(filterLoc) } : {}) })} className="hover:text-ink">Luna curentă</Link>
        <Link href={href({ from: today, to: today, ...(filterLoc ? { loc: String(filterLoc) } : {}) })} className="hover:text-ink">Azi</Link>
      </div>
    </>
  );
}
