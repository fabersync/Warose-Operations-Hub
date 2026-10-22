import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapoarte" };

export default async function ReportsPage() {
  await requireUser("dashboard");
  const reports = await q<{ id: number; kind: string; title: string; created_at: string }>(
    "SELECT id, kind, title, created_at FROM reports ORDER BY period_from DESC, kind LIMIT 120");
  return (
    <>
      <PageHeader title="Rapoarte" description="Generate automat: raportul zilnic dimineața (ziua precedentă) și raportul lunar la începutul lunii. Se trimit și pe email sau către n8n / Make, după setări." />
      <Card pad={false}>
        {reports.length ? (
          <table className="table">
            <thead><tr><th>Raport</th><th>Tip</th><th>Generat</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/rapoarte/${r.id}`} className="font-medium text-ink hover:text-crust">{r.title}</Link></td>
                  <td>{r.kind === "daily" ? <Badge>zilnic</Badge> : <Badge tone="accent">lunar</Badge>}</td>
                  <td className="text-xs text-muted">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState icon={<FileBarChart className="size-5" />} title="Niciun raport generat încă">Primul raport zilnic se generează la ora setată în Setări → Automatizări.</EmptyState>}
      </Card>
    </>
  );
}
