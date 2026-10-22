import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtNum, fmtRon } from "@/lib/format";
import { canPurchase, candidateInvoices, getPurchaseOrder, PO_STATUS, purchasingLocations } from "@/lib/purchasing";
import { Badge, Card, Notice } from "@/components/ui";
import { DeliverForm, PurchaseOrderForm, SendForm } from "../Forms";
import { cancelPurchaseOrder, saveSupplierContact } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comandă furnizor" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchasing");
  const o = await getPurchaseOrder(user, Number((await params).id));
  if (!o) notFound();
  const edit = canPurchase(user, o.location_id);
  const st = PO_STATUS[o.status];
  const est = o.lines.reduce((s, l) => s + l.qty * (l.est_price ?? 0), 0);
  const draftEdit = o.status === "draft" && edit;
  const locations = draftEdit ? await purchasingLocations(user) : [];
  const suppliers = draftEdit ? await q<{ id: number; name: string }>("SELECT id, name FROM suppliers ORDER BY name") : [];
  const products = draftEdit ? await q<{ id: number; name: string; unit: string; cost_price: number | null }>(
    "SELECT id, name, unit, cost_price::float8 cost_price FROM products WHERE active ORDER BY category IN ('raw','packaging') DESC, name") : [];
  const createdDay = new Date(o.created_at).toISOString().slice(0, 10);
  const invoices = o.status === "sent" && edit ? await candidateInvoices(o.supplier_id, o.needed_for ?? createdDay) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/aprovizionare" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Comenzi furnizori</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[24px] font-semibold tracking-tight text-ink">Comanda #{o.id} · {o.supplier} <Badge tone={st.tone}>{st.label}</Badge></h1>
          <p className="mt-1 text-sm text-muted">
            Livrare la {o.location}{o.needed_for && ` · ${fmtDate(o.needed_for)}`} · creată de {o.author}, {fmtDateTime(o.created_at)}
            {o.sent_at && ` · trimisă ${fmtDateTime(o.sent_at)} (${o.sent_via === "email" ? "email" : "manual"})`}
            {o.delivered_at && ` · livrată ${fmtDateTime(o.delivered_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/aprovizionare/${o.id}/tiparire`} className="btn btn-ghost"><Printer className="size-4" />Listă tipăribilă</Link>
          <a href={`/api/export/purchase-order/${o.id}`} className="btn btn-ghost"><Download className="size-4" />Excel</a>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {draftEdit ? (
            <Card title="Ciornă">
              <PurchaseOrderForm locations={locations} suppliers={suppliers} products={products}
                initial={{ order_id: o.id, location_id: o.location_id, supplier_id: o.supplier_id, needed_for: o.needed_for ?? "", note: o.note, lines: o.lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) }} />
            </Card>
          ) : (
            <Card title="Produse" subtitle={o.invoice_id ? `Comparație cu factura nr. ${o.invoice_number}` : "Prețuri estimate din ultimele facturi, fără TVA"} pad={false}>
              <table className="table">
                <thead><tr><th>Produs</th><th className="num">Comandat</th><th className="num">Primit</th>{o.invoice_id && <th className="num">Facturat</th>}<th className="num">Estimat</th>{o.invoice_id && <th className="num">Facturat (lei)</th>}</tr></thead>
                <tbody>
                  {o.lines.map((l) => {
                    const diff = l.invoiced_qty != null && Math.abs(l.invoiced_qty - l.qty) > 1e-6;
                    return (
                      <tr key={l.id}>
                        <td className="font-medium text-ink">{l.product}</td>
                        <td className="num">{fmtNum(l.qty)} {l.unit}</td>
                        <td className="num">{l.received_qty != null ? fmtNum(l.received_qty) : "—"}</td>
                        {o.invoice_id && <td className={`num ${diff ? "text-warn" : ""}`}>{l.invoiced_qty != null ? fmtNum(l.invoiced_qty) : <span className="text-faint">neasociat</span>}</td>}
                        <td className="num text-muted">{l.est_price != null ? fmtRon(l.qty * l.est_price, true) : "—"}</td>
                        {o.invoice_id && <td className="num">{l.invoiced_net != null ? fmtRon(l.invoiced_net, true) : "—"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td colSpan={o.invoice_id ? 4 : 3} className="px-4 py-3 text-sm font-medium">Total estimat</td><td className="num px-4 py-3 font-semibold">{fmtRon(est, true)}</td>{o.invoice_id && <td />}</tr></tfoot>
              </table>
            </Card>
          )}
          {o.note && !draftEdit && <Notice>{o.note}</Notice>}
        </div>

        <div className="space-y-4">
          {edit && o.status === "draft" && <Card title="Trimitere"><SendForm orderId={o.id} hasEmail={!!o.supplier_email} /></Card>}
          {edit && o.status === "sent" && <Card title="Livrare"><DeliverForm orderId={o.id} lines={o.lines} invoices={invoices} /></Card>}
          <Card title="Contact furnizor">
            {edit ? (
              <form action={saveSupplierContact} className="space-y-2">
                <input type="hidden" name="supplier_id" value={o.supplier_id} />
                <input name="email" type="email" defaultValue={o.supplier_email ?? ""} placeholder="email pentru comenzi" aria-label="Email furnizor" className="input" />
                <input name="phone" defaultValue={o.supplier_phone ?? ""} placeholder="telefon" aria-label="Telefon furnizor" className="input" />
                <button className="btn btn-ghost w-full">Salvează contactul</button>
              </form>
            ) : <p className="text-sm text-ink-2">{o.supplier_email ?? "—"} · {o.supplier_phone ?? "—"}</p>}
          </Card>
          {edit && ["draft", "sent"].includes(o.status) && (
            <form action={cancelPurchaseOrder}><input type="hidden" name="order_id" value={o.id} /><button className="btn btn-danger w-full">Anulează comanda</button></form>
          )}
        </div>
      </div>
    </div>
  );
}
