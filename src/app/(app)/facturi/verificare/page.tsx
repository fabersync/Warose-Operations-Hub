import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { extractXml, parseEInvoice } from "@/lib/efactura";
import { fmtDate, fmtRon } from "@/lib/format";
import { readFile } from "@/lib/storage";
import { Badge, Card, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificare facturi importate" };

/**
 * Modul de test: recitește fișierul original al fiecărei facturi e-Factura importate și compară
 * totalurile (fără TVA, TVA, total, număr de linii, suma liniilor) cu ce este înregistrat în aplicație.
 */
export default async function InvoiceCheckPage() {
  await requireUser("invoices");
  const rows = await q<{ id: number; supplier: string; number: string; issue_date: string; file_path: string | null; file_name: string | null; is_credit_note: boolean;
    total_net: number; total_vat: number; total_gross: number; lines: number; sum_lines: number }>(
    `SELECT i.id, s.name supplier, i.number, i.issue_date::text issue_date, i.file_path, i.file_name, i.is_credit_note,
            i.total_net::float8 total_net, i.total_vat::float8 total_vat, i.total_gross::float8 total_gross,
            (SELECT count(*)::int FROM invoice_lines l WHERE l.invoice_id = i.id) lines,
            (SELECT coalesce(sum(net), 0)::float8 FROM invoice_lines l WHERE l.invoice_id = i.id) sum_lines
       FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.source = 'efactura' AND i.status <> 'cancelled' ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`);

  const checks = await Promise.all(rows.map(async (r) => {
    const problems: string[] = [];
    try {
      const inv = parseEInvoice(extractXml(await readFile(r.file_path!), r.file_name ?? "factura.xml"));
      const sign = inv.isCreditNote ? -1 : 1;
      const cmp = (label: string, file: number, app: number) => { if (Math.abs(file - app) > 0.01) problems.push(`${label}: fișier ${file.toFixed(2)}, aplicație ${app.toFixed(2)}`); };
      cmp("Fără TVA", sign * inv.totalNet, r.total_net);
      cmp("TVA", sign * inv.totalVat, r.total_vat);
      cmp("Total", sign * inv.totalGross, r.total_gross);
      cmp("Suma liniilor", sign * inv.totalNet, r.sum_lines);
      if (inv.lines.length !== r.lines) problems.push(`Linii: fișier ${inv.lines.length}, aplicație ${r.lines}`);
    } catch (e) {
      problems.push(`Fișierul original nu poate fi citit: ${(e as Error).message}`);
    }
    return { ...r, problems };
  }));
  const bad = checks.filter((c) => c.problems.length);

  return (
    <div className="space-y-4">
      {rows.length === 0 ? <Notice>Nu există încă facturi importate din e-Factura.</Notice> : bad.length === 0
        ? <Notice tone="good" title={`Toate cele ${rows.length} facturi e-Factura corespund fișierelor originale`}>Totalurile fără TVA, TVA, totalul, numărul de linii și suma liniilor sunt identice.</Notice>
        : <Notice tone="bad" title={`${bad.length} din ${rows.length} facturi diferă de fișierul original`}>Deschideți factura și verificați; fișierul original rămâne păstrat neschimbat.</Notice>}
      <Card title="Comparație cu fișierele originale" subtitle="Ultimele 500 de facturi e-Factura" pad={false}>
        <table className="table">
          <thead><tr><th>Furnizor</th><th>Număr</th><th>Data</th><th className="num">Total</th><th className="num">Linii</th><th>Rezultat</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/facturi/${c.id}`} className="font-medium text-ink hover:text-crust">{c.supplier}</Link></td>
                <td className="text-xs">{c.number}</td>
                <td className="whitespace-nowrap text-xs">{fmtDate(c.issue_date)}</td>
                <td className="num">{fmtRon(c.total_gross, true)}</td>
                <td className="num">{c.lines}</td>
                <td>{c.problems.length
                  ? <div className="text-xs text-bad"><XCircle className="mr-1 inline size-3.5" />{c.problems.join(" · ")}</div>
                  : <Badge tone="good"><CheckCircle2 className="size-3" />identic</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
