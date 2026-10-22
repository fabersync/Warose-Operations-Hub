import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { addDays, todayLocal } from "@/lib/format";
import { orderableProducts } from "@/lib/orders";
import { locationsFor } from "@/lib/queries";
import { Card, Notice, PageHeader } from "@/components/ui";
import { OrderForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comandă nouă" };

export default async function NewOrderPage() {
  const user = await requireUser("orders");
  if (!["admin", "location_manager"].includes(user.role)) redirect("/comenzi");
  const [from, suppliersAll, products] = await Promise.all([
    locationsFor(user, ["store"]),
    // Furnizorii nu depind de locațiile utilizatorului: orice magazin poate comanda din depozit sau BRUTĂRIE.
    q<{ id: number; name: string }>("SELECT id, name FROM locations WHERE active AND kind IN ('freezer','production') ORDER BY kind = 'production', id"),
    orderableProducts(),
  ]);
  return (
    <>
      <PageHeader title="Comandă nouă" actions={<Link href="/comenzi" className="btn btn-ghost"><ArrowLeft className="size-4" />Comenzi</Link>} />
      {!from.length ? <Notice tone="warn">Nu aveți asociată nicio locație de vânzare.</Notice> : !products.length ? (
        <Notice tone="warn">Nu există produse congelate sau produse finite în catalog. Marcați-le în Produse & coduri.</Notice>
      ) : (
        <Card subtitle="Doar produsele congelate și produsele finite pot fi comandate">
          <OrderForm fromLocations={from} toLocations={suppliersAll} products={products}
            initial={{ from: from[0].id, to: suppliersAll[0]?.id ?? 0, needed_for: addDays(todayLocal(), 1), note: null, lines: [] }} />
        </Card>
      )}
    </>
  );
}
