import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPurchaseOrder } from "@/lib/purchasing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comanda către furnizor în Excel (de trimis furnizorului sau de păstrat). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !canAccess(user, "purchasing")) return new Response("Neautorizat", { status: 401 });
  const o = await getPurchaseOrder(user, Number((await params).id));
  if (!o) return new Response("Comanda nu există", { status: 404 });
  const ws = XLSX.utils.aoa_to_sheet([
    [`Comandă nr. ${o.id}`],
    [`Furnizor: ${o.supplier}${o.cif ? ` (CIF ${o.cif})` : ""}`],
    [`Livrare la: ${o.location}${o.needed_for ? ` · data dorită: ${o.needed_for}` : ""}`],
    [o.note ?? ""],
    [],
  ]);
  XLSX.utils.sheet_add_json(ws, o.lines.map((l) => ({
    "Produs": l.product, "Cantitate": l.qty, "UM": l.unit,
    "Preț estimat (fără TVA)": l.est_price ?? "", "Valoare estimată": l.est_price != null ? Math.round(l.qty * l.est_price * 100) / 100 : "",
    "Primit": l.received_qty ?? "",
  })), { origin: "A6" });
  ws["!cols"] = [{ wch: 40 }, { wch: 10 }, { wch: 6 }, { wch: 20 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comanda");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.purchase_order", entity: "purchase_order", entityId: o.id });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Comanda_${o.id}_${o.supplier.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30)}.xlsx"`,
    },
  });
}
