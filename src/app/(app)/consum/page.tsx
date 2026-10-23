import { UsesView, type UsesSP } from "./View";

export const dynamic = "force-dynamic";
export const metadata = { title: "Consum personal & protocol" };

export default async function ConsumptionPage({ searchParams }: { searchParams: Promise<UsesSP> }) {
  const sp = await searchParams;
  return <UsesView kind={sp.k === "protocol" ? "protocol" : "staff"} sp={sp}
    tabs={[{ kind: "staff", href: "/consum" }, { kind: "protocol", href: "/consum?k=protocol" }]} />;
}
