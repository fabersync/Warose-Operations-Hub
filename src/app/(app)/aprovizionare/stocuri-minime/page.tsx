import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { canPurchase, purchasingLocations } from "@/lib/purchasing";
import { Card, Notice, PageHeader } from "@/components/ui";
import { TargetsForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocuri minime" };

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const user = await requireUser("purchasing");
  const locations = await purchasingLocations(user);
  const wanted = Number((await searchParams).loc);
  const loc = locations.find((l) => l.id === wanted) ?? locations[0];
  const rows = loc ? await q<{ id: number; name: string; unit: string; stock: number; min_qty: number | null; target_qty: number | null }>(
    `SELECT p.id, p.name, p.unit,
            coalesce((SELECT sum(qty) FROM stock_movements m WHERE m.location_id = $1 AND m.product_id = p.id), 0)::float8 stock,
            t.min_qty::float8 min_qty, t.target_qty::float8 target_qty
       FROM products p LEFT JOIN stock_targets t ON t.product_id = p.id AND t.location_id = $1
      WHERE p.active AND (p.track_stock OR t.product_id IS NOT NULL OR p.category IN ('raw','packaging'))
      ORDER BY (t.product_id IS NULL), p.name`, [loc.id]) : [];
  return (
    <>
      <PageHeader title="Stocuri minime" description="Pentru fiecare locație: sub ce cantitate trebuie comandat și până la ce nivel. Stocul actual este cel operațional din aplicație."
        actions={<Link href={`/aprovizionare?loc=${loc?.id ?? ""}`} className="btn btn-ghost"><ArrowLeft className="size-4" />Comenzi furnizori</Link>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {locations.map((l) => (
          <Link key={l.id} href={`/aprovizionare/stocuri-minime?loc=${l.id}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${l.id === loc?.id ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:bg-canvas"}`}>{l.name}</Link>
        ))}
      </div>
      {loc && canPurchase(user, loc.id)
        ? <Card title={loc.name}><TargetsForm locationId={loc.id} rows={rows} /></Card>
        : <Notice>Nu aveți dreptul să modificați stocurile minime ale acestei locații.</Notice>}
    </>
  );
}
