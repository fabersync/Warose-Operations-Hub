import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { FinanceTabs } from "./Tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireUser("invoices");
  return (
    <>
      <PageHeader
        title="Facturi & costuri"
        description="Facturile furnizorilor se introduc o singură dată: din e-Factura (SPV) sau manual. După verificare, costurile se alocă automat pe locații, prețurile materiilor prime se actualizează, iar marfa intră în stoc."
      />
      <FinanceTabs />
      {children}
    </>
  );
}
