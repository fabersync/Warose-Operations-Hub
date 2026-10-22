import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { getOrder } from "@/lib/orders";
import { Notice } from "@/components/ui";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document de transfer" };

/**
 * Datele pentru avizul de însoțire / transferul între gestiuni. Document intern, tipăribil:
 * avizul oficial se emite în SAGA C cu aceste date.
 */
export default async function TransferDocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("orders");
  const o = await getOrder(user, Number((await params).id));
  if (!o || !["shipped", "received"].includes(o.status)) notFound();
  const byProduct = new Map(o.lines.map((l) => [l.product, l]));
  const total = o.shipments.reduce((s, x) => s + x.qty, 0);

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/comenzi/${o.id}`} className="btn btn-ghost"><ArrowLeft className="size-4" />Comanda #{o.id}</Link>
        <PrintButton />
      </div>
      <div className="mb-4 print:hidden"><Notice tone="warn">Document intern cu datele transferului. Avizul de însoțire oficial se emite în SAGA C.</Notice></div>

      <article className="card p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="eyebrow">Warose Bakery · document intern</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Transfer între gestiuni</h1>
            <p className="mt-1 text-sm text-muted">Comanda #{o.id} · necesar pentru {fmtDate(o.needed_for)}</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Expediat</dt><dd className="text-ink">{fmtDateTime(o.shipped_at)}</dd>
            <dt className="text-muted">Recepționat</dt><dd className="text-ink">{o.received_at ? fmtDateTime(o.received_at) : "—"}</dd>
          </dl>
        </header>
        <div className="grid grid-cols-2 gap-6 border-b border-line py-5 text-sm">
          <div><div className="eyebrow mb-1">Gestiune predătoare</div><div className="font-medium text-ink">{o.to_name}</div></div>
          <div><div className="eyebrow mb-1">Gestiune primitoare</div><div className="font-medium text-ink">{o.from_name}</div></div>
        </div>
        <table className="table mt-4">
          <thead><tr><th>Cod SAGA</th><th>Denumire</th><th>Lot</th><th>Expiră</th><th className="num">Cantitate</th><th className="num">Recepționat</th></tr></thead>
          <tbody>
            {o.shipments.map((s, i) => {
              const line = byProduct.get(s.product);
              return (
                <tr key={i}>
                  <td className="font-mono text-xs">{line?.saga_code ?? "—"}</td>
                  <td className="font-medium text-ink">{s.product}</td>
                  <td className="text-xs">{s.lot ?? "—"}</td>
                  <td className="text-xs">{fmtDate(s.expires_on)}</td>
                  <td className="num">{fmtNum(s.qty)} {line?.unit}</td>
                  <td className="num text-muted">{line?.received_qty != null ? fmtNum(line.received_qty) : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={4} className="px-4 py-3 text-sm font-medium">Total</td><td className="num px-4 py-3 font-semibold">{fmtNum(total)}</td><td /></tr></tfoot>
        </table>
        <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
          <div><div className="border-t border-ink-2 pt-2 text-muted">Predat (nume, semnătură)</div></div>
          <div><div className="border-t border-ink-2 pt-2 text-muted">Primit (nume, semnătură)</div></div>
        </footer>
      </article>
    </div>
  );
}
