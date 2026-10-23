import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/** Alegerea produsului pentru o rețetă nouă (formular GET) → pagina rețetei. */
export default async function PickRecipeProduct({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireUser("production");
  const id = Number((await searchParams).p);
  redirect(id ? `/productie/retete/${id}` : "/productie/retete");
}
