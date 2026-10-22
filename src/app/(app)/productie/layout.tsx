import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProductionTabs } from "./Tabs";

export default async function ProductionLayout({ children }: { children: React.ReactNode }) {
  await requireUser("production");
  return (
    <>
      <PageHeader
        title="Producție & rețete"
        description="Rețete versionate, plan de producție cu necesar de materii prime, înregistrarea producției reale și documentul pregătit pentru SAGA C. Aplicația nu scrie în baza SAGA."
      />
      <ProductionTabs />
      {children}
    </>
  );
}
