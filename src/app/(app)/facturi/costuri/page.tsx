import { Download, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtRon, todayLocal } from "@/lib/format";
import { costMonth, getSetting } from "@/lib/invoices";
import { Badge, Card, Notice } from "@/components/ui";
import { CostEntryForm } from "../Forms";
import { deleteCostEntry } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costuri lunare" };

const MONTHS = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser("invoices");
  const sp = await searchParams;
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : todayLocal().slice(0, 7);
  const [data, locations, categories, rules, eur, months] = await Promise.all([
    costMonth(month),
    q<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active AND kind <> 'freezer' ORDER BY id"),
    q<{ id: number; name: string }>("SELECT id, name FROM expense_categories WHERE active ORDER BY sort, name"),
    q<{ id: number; name: string }>("SELECT id, name FROM allocation_rules ORDER BY name"),
    getSetting<number>("eur_rate", 5),
    q<{ m: string }>(`SELECT DISTINCT to_char(d, 'YYYY-MM') m FROM (SELECT entry_date d FROM cost_entries UNION SELECT sold_date FROM sales_lines) x ORDER BY 1 DESC LIMIT 36`),
  ]);
  const monthList = [...new Set([todayLocal().slice(0, 7), ...months.map((x) => x.m)])].sort().reverse();
  const cell = (loc: number, cat: number) => data.cells.find((c) => c.location_id === loc && c.category_id === cat)?.amount ?? 0;
  const usedCats = categories.filter((c) => data.cells.some((x) => x.category_id === c.id));
  const locTotal = (loc: number) => data.cells.filter((c) => c.location_id === loc).reduce((s, c) => s + c.amount, 0);
  const rev = (loc: number) => data.revenue.find((r) => r.location_id === loc)?.amount ?? 0;
  const totalCost = data.cells.reduce((s, c) => s + c.amount, 0);
  const totalRev = data.revenue.reduce((s, r) => s + r.amount, 0);
  const eurFmt = (v: number) => new Intl.NumberFormat("ro-RO", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v / eur);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2">
          <select name="m" defaultValue={month} className="input w-auto py-1.5" aria-label="Luna">{monthList.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
          <button className="btn btn-ghost py-1.5">Arată</button>
        </form>
        <a href={`/api/export/costs?m=${month}`} className="btn btn-primary ml-auto py-1.5"><Download className="size-4" />Raport Costuri – Venituri (Excel)</a>
      </div>

      <Card title={`Costuri și venituri · ${label(month)}`} subtitle={`Sume fără TVA · EUR la cursul ${eur} lei`} pad={false}>
        <table className="table">
          <thead><tr><th>Categorie</th>{locations.map((l) => <th key={l.id} className="num">{l.name}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            <tr className="bg-good-soft/40">
              <td className="font-medium text-ink">Venituri (vânzări Publine)</td>
              {locations.map((l) => <td key={l.id} className="num">{rev(l.id) ? fmtRon(rev(l.id)) : "—"}</td>)}
              <td className="num font-medium">{fmtRon(totalRev)}</td>
            </tr>
            {usedCats.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {locations.map((l) => <td key={l.id} className="num">{cell(l.id, c.id) ? fmtRon(cell(l.id, c.id)) : <span className="text-faint">—</span>}</td>)}
                <td className="num">{fmtRon(locations.reduce((s, l) => s + cell(l.id, c.id), 0))}</td>
              </tr>
            ))}
            {!usedCats.length && <tr><td colSpan={locations.length + 2} className="text-center text-muted">Niciun cost înregistrat în această lună.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className="px-4 py-3 font-medium">Total costuri</td>
              {locations.map((l) => <td key={l.id} className="num px-4 py-3 font-medium">{fmtRon(locTotal(l.id))}</td>)}
              <td className="num px-4 py-3 font-semibold">{fmtRon(totalCost)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium">Rezultat estimat</td>
              {locations.map((l) => { const r = rev(l.id) - locTotal(l.id); return <td key={l.id} className={`num px-4 py-3 font-semibold ${r < 0 ? "text-bad" : "text-good"}`}>{fmtRon(r)}<div className="text-xs font-normal text-muted">{eurFmt(r)}</div></td>; })}
              <td className={`num px-4 py-3 font-semibold ${totalRev - totalCost < 0 ? "text-bad" : "text-good"}`}>{fmtRon(totalRev - totalCost)}<div className="text-xs font-normal text-muted">{eurFmt(totalRev - totalCost)}</div></td>
            </tr>
          </tfoot>
        </table>
      </Card>
      <Notice tone="warn" title="Rezultat estimat, nu profit contabil">
        Venituri din Publine minus costurile introduse în aplicație. Nu include variația stocurilor și nici costurile care nu au fost încă introduse (ex: salarii, chirie) — completați-le manual alături.
      </Notice>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Înregistrări" subtitle={`${data.entries.length} în ${label(month)}`} pad={false}>
          <table className="table">
            <thead><tr><th>Data</th><th>Locație</th><th>Categorie</th><th className="num">Sumă</th><th>Furnizor / comentariu</th><th></th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(e.entry_date)}</td>
                  <td className="text-xs">{e.location}</td>
                  <td><Badge>{e.category}</Badge></td>
                  <td className="num">{fmtRon(e.amount_net, true)}</td>
                  <td className="max-w-[280px] text-xs text-muted"><span className="text-ink-2">{e.supplier ?? "—"}</span>{e.description && ` · ${e.description}`}{e.invoice_id && <> · <a href={`/facturi/${e.invoice_id}`} className="text-crust">factura</a></>}</td>
                  <td>{e.source === "manual" && (
                    <form action={deleteCostEntry}><input type="hidden" name="entry_id" value={e.id} /><button className="rounded-md p-1.5 text-muted hover:text-bad" aria-label="Șterge costul manual"><Trash2 className="size-4" /></button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Cost fără factură" subtitle="Salarii, chirie, amortizări, comisioane bancare">
          <CostEntryForm categories={categories} locations={locations} rules={rules} defaultDate={`${month}-${month === todayLocal().slice(0, 7) ? todayLocal().slice(8) : "01"}`} />
        </Card>
      </div>
    </div>
  );
}
