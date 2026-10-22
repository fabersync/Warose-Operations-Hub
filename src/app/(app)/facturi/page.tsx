import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { fmtDate, fmtNum, fmtRon, monthStart, todayLocal } from "@/lib/format";
import { listInvoices } from "@/lib/invoices";
import { Badge, Card, EmptyState, Kpi, Notice } from "@/components/ui";
import { EInvoiceUpload } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facturi" };

const FILTERS = [
  { v: "draft", l: "De verificat" },
  { v: "saga", l: "De introdus în SAGA" },
  { v: "verified", l: "Verificate" },
  { v: "cancelled", l: "Anulate" },
  { v: "all", l: "Toate" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireUser("invoices");
  const s = (await searchParams).s ?? "draft";
  const month = monthStart(todayLocal());
  const [rows, stats] = await Promise.all([
    listInvoices(s),
    one<{ drafts: number; saga: number; month_net: number; month_count: number }>(
      `SELECT count(*) FILTER (WHERE status = 'draft')::int drafts,
              count(*) FILTER (WHERE status = 'verified' AND saga_registered_at IS NULL)::int saga,
              coalesce(sum(total_net) FILTER (WHERE status = 'verified' AND issue_date >= $1::date), 0)::float8 month_net,
              count(*) FILTER (WHERE status = 'verified' AND issue_date >= $1::date)::int month_count
         FROM invoices`, [month]),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="De verificat" value={fmtNum(stats!.drafts)} hint={<span>importate, neconfirmate</span>} />
        <Kpi label="De introdus în SAGA" value={fmtNum(stats!.saga)} hint={<span>verificate, nemarcate în SAGA</span>} />
        <Kpi label="Achiziții luna curentă" value={fmtRon(stats!.month_net)} hint={<span>{stats!.month_count} facturi verificate, fără TVA</span>} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card pad={false} title="Facturi furnizori" action={<Link href="/facturi/nou" className="btn btn-primary py-1.5"><Plus className="size-4" />Factură manuală</Link>}>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3 sm:px-6">
            {FILTERS.map((f) => (
              <Link key={f.v} href={`/facturi?s=${f.v}`} className={`rounded-md px-2.5 py-1 text-xs font-medium ${s === f.v ? "bg-ink text-white" : "bg-canvas text-ink-2 hover:bg-line"}`}>{f.l}</Link>
            ))}
          </div>
          {rows.length ? (
            <table className="table">
              <thead><tr><th>Furnizor</th><th>Număr</th><th>Data</th><th className="num">Fără TVA</th><th className="num">Total</th><th>Linii</th><th>Stare</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/facturi/${r.id}`} className="font-medium text-ink hover:text-crust">{r.supplier}</Link><div className="text-xs text-muted">{r.cif ?? "fără CIF"} · {r.source === "efactura" ? "e-Factura" : "manual"}</div></td>
                    <td className="text-xs">{r.number}{r.is_credit_note && <div><Badge tone="info">storno</Badge></div>}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(r.issue_date)}</td>
                    <td className="num">{fmtRon(r.total_net, true)}</td>
                    <td className="num">{fmtRon(r.total_gross, true)}</td>
                    <td className="text-xs">{r.mapped}/{r.lines} asociate</td>
                    <td>
                      {r.status === "draft" ? <Badge tone="warn">De verificat</Badge> : r.status === "cancelled" ? <Badge>Anulată</Badge> : r.saga ? <Badge tone="good">În SAGA</Badge> : <Badge tone="accent">Verificată</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<FileText className="size-5" />} title="Nicio factură în această listă">Importați facturile din SPV sau introduceți una manual.</EmptyState>}
        </Card>

        <div className="space-y-4">
          <Card title="Import e-Factura" subtitle="Din SPV (ANAF): Facturi primite → descarcă"><EInvoiceUpload /></Card>
          <Notice title="De ce e-Factura">
            XML-ul din SPV conține datele oficiale ale facturii (furnizor, CIF, linii, TVA), deci nu trebuie copiate de pe PDF. Facturile fără e-Factura (bonuri, PDF-uri) se introduc manual, cu documentul atașat pentru verificare.
          </Notice>
        </div>
      </div>
    </div>
  );
}
