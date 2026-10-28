import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtNum } from "@/lib/format";
import { getPurchaseOrder } from "@/lib/purchasing";
import { PrintButton } from "@/app/(app)/comenzi/[id]/aviz/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listă de comandă" };

/** Lista tipăribilă: pentru furnizorii comandați telefonic sau pentru cumpărăturile de la Metro (cu căsuțe de bifat). */
export default async function PrintPurchaseOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("purchasing");
  const o = await getPurchaseOrder(user, Number((await params).id));
  if (!o) notFound();
  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex justify-between print:hidden">
        <Link href={`/aprovizionare/${o.id}`} className="btn btn-ghost"><ArrowLeft className="size-4" />Comanda #{o.id}</Link>
        <PrintButton />
      </div>
      <article className="card p-8 print:border-0 print:p-0 print:shadow-none">
        <div className="eyebrow">Comandă către furnizor</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Comanda #{o.id} — {o.supplier}</h1>
        <p className="mt-1 text-sm text-muted">Livrare la {o.location}{o.needed_for && ` · ${fmtDate(o.needed_for)}`}{o.cif && ` · CIF furnizor ${o.cif}`}</p>
        <div className="mt-6 overflow-x-auto">
        <table className="table">
          <thead><tr><th className="w-8"></th><th>Produs</th><th className="num">Cantitate</th><th>Observații</th></tr></thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id}><td><span className="inline-block size-4 rounded border border-ink-2" /></td><td className="font-medium text-ink">{l.product}</td><td className="num">{fmtNum(l.qty)} {l.unit}</td><td /></tr>
            ))}
          </tbody>
        </table>
        </div>
        {o.note && <p className="mt-4 text-sm">{o.note}</p>}
      </article>
    </div>
  );
}
