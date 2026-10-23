import { UsesView, type UsesSP } from "../consum/View";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pierderi" };

export default async function LossesPage({ searchParams }: { searchParams: Promise<UsesSP> }) {
  return <UsesView kind="loss" sp={await searchParams} />;
}
