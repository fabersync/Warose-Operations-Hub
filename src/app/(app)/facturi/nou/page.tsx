import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { Card } from "@/components/ui";
import { ManualInvoiceForm } from "../Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Factură manuală" };

export default async function NewInvoicePage() {
  await requireUser("invoices");
  const suppliers = await q<{ id: number; name: string; cif: string | null }>("SELECT id, name, cif FROM suppliers ORDER BY name");
  return (
    <Card title="Factură introdusă manual" subtitle="Pentru documente fără e-Factura. Prețurile se introduc fără TVA; după salvare urmează ecranul de verificare.">
      <ManualInvoiceForm suppliers={suppliers} />
    </Card>
  );
}
