import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtRon } from "@/lib/format";
import { getInvoice } from "@/lib/invoices";
import { Badge, Card, Notice } from "@/components/ui";
import { CancelInvoiceForm, ReopenForm, VerifyForm } from "../Forms";
import { markSaga } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Factură" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("invoices");
  const inv = await getInvoice(Number((await params).id));
  if (!inv) notFound();
  const [products, categories, rules, locations, costs] = await Promise.all([
    q<{ id: number; name: string; unit: string; track_stock: boolean }>(
      "SELECT id, name, unit, track_stock FROM products WHERE active ORDER BY category IN ('raw','packaging') DESC, name"),
    q<{ id: number; name: string }>("SELECT id, name FROM expense_categories WHERE active ORDER BY sort, name"),
    q<{ id: number; name: string }>("SELECT id, name FROM allocation_rules ORDER BY name"),
    q<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM locations WHERE active ORDER BY id"),
    q<{ location: string; category: string; amount: number }>(
      `SELECT l.name location, c.name category, sum(e.amount_net)::float8 amount FROM cost_entries e
         JOIN locations l ON l.id = e.location_id JOIN expense_categories c ON c.id = e.category_id
        WHERE e.invoice_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [inv.id]),
  ]);
  const draft = inv.status === "draft";
  const docUrl = inv.pdf_path ? `/api/files/invoice/${inv.id}?kind=pdf` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/facturi" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Facturi</Link>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            {inv.supplier} · nr. {inv.number}
            {draft ? <Badge tone="warn">De verificat</Badge> : inv.status === "cancelled" ? <Badge>Anulată</Badge> : <Badge tone="good">Verificată</Badge>}
            {inv.is_credit_note && <Badge tone="info">Storno</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {inv.cif ? `CIF ${inv.cif}` : "fără CIF"} · emisă {fmtDate(inv.issue_date)}{inv.due_date && ` · scadentă ${fmtDate(inv.due_date)}`} · {inv.source === "efactura" ? "e-Factura" : "introdusă manual"} de {inv.author ?? "—"}
            {inv.verified_by && ` · verificată de ${inv.verified_by}, ${fmtDateTime(inv.verified_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.file_path && <a href={`/api/files/invoice/${inv.id}`} target="_blank" className="btn btn-ghost"><FileDown className="size-4" />XML original</a>}
          {docUrl && <a href={docUrl} target="_blank" className="btn btn-ghost"><FileDown className="size-4" />Document</a>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-pad"><div className="eyebrow">Fără TVA</div><div className="mt-2 text-2xl font-semibold tabular-nums">{fmtRon(inv.total_net, true)}</div></div>
        <div className="card card-pad"><div className="eyebrow">TVA</div><div className="mt-2 text-2xl font-semibold tabular-nums">{fmtRon(inv.total_vat, true)}</div></div>
        <div className="card card-pad"><div className="eyebrow">Total {inv.currency}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{fmtRon(inv.total_gross, true)}</div></div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title={draft ? "Verificare" : "Linii și asocieri"} subtitle={draft ? "Asociați liniile cu materiile prime (pentru prețuri și stoc), alegeți categoria și locațiile care suportă costul" : undefined}>
          <VerifyForm
            editable={draft}
            invoice={{ id: inv.id, category_id: inv.category_id, rule_id: inv.rule_id, allocation_location_id: inv.allocation_location_id, receipt_location_id: inv.receipt_location_id, note: inv.note, total_net: inv.total_net }}
            lines={inv.lines} products={products} categories={categories} rules={rules}
            locations={locations.filter((l) => l.kind !== "freezer")} receiptLocations={locations}
          />
        </Card>
        {docUrl && /\.pdf$/i.test(inv.pdf_path ?? "") && (
          <Card title="Documentul" pad={false}><iframe src={docUrl} title="Factura PDF" className="h-[640px] w-full rounded-b-xl" /></Card>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {!draft && inv.status !== "cancelled" && (
          <Card title="Costuri alocate" subtitle="Intrate în registrul de costuri la data facturii" pad={false}>
            <table className="table">
              <thead><tr><th>Locație</th><th>Categorie</th><th className="num">Sumă fără TVA</th></tr></thead>
              <tbody>{costs.map((c) => <tr key={c.location + c.category}><td>{c.location}</td><td>{c.category}</td><td className="num">{fmtRon(c.amount, true)}</td></tr>)}</tbody>
            </table>
          </Card>
        )}
        <Card title="SAGA C și acțiuni">
          <div className="space-y-3">
            {inv.status === "verified" && (inv.saga_registered_at ? (
              <>
                <Notice tone="good" title="Înregistrată în SAGA">{fmtDateTime(inv.saga_registered_at)}{inv.saga_note && ` · ${inv.saga_note}`}</Notice>
                <form action={markSaga}><input type="hidden" name="invoice_id" value={inv.id} /><input type="hidden" name="undo" value="1" /><button className="btn btn-ghost w-full">Anulează marcajul SAGA</button></form>
              </>
            ) : (
              <form action={markSaga} className="space-y-2">
                <input type="hidden" name="invoice_id" value={inv.id} />
                <input name="saga_note" placeholder="ex: NIR 1234 în SAGA" aria-label="Notă SAGA" className="input" />
                <button className="btn btn-primary w-full">Marchează ca introdusă în SAGA</button>
              </form>
            ))}
            {inv.status === "verified" && !inv.saga_registered_at && <ReopenForm invoiceId={inv.id} />}
            {draft && <CancelInvoiceForm invoiceId={inv.id} />}
            {inv.status === "cancelled" && <Notice>{inv.note}</Notice>}
          </div>
        </Card>
      </div>
    </div>
  );
}
