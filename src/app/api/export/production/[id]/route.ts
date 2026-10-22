import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getOrder } from "@/lib/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Documentul de producție aprobat, în structura documentului de producție din SAGA C
 * (produse finite obținute + materii prime consumate, cu codurile SAGA asociate), pentru introducere în SAGA.
 * Nu este un fișier de import SAGA: formatul de import trebuie confirmat separat.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !canAccess(user, "production")) return new Response("Neautorizat", { status: 401 });
  const order = await getOrder(user, Number((await params).id));
  if (!order || order.status !== "approved") return new Response("Document inexistent sau neaprobat", { status: 404 });

  const fin = order.lines.filter((l) => (l.produced_qty ?? 0) > 0).map((l) => ({
    "Cod SAGA": l.saga_code ?? "NEASOCIAT",
    "Denumire": l.product,
    "UM": l.unit.toUpperCase(),
    "Cantitate obținută": l.produced_qty,
    "Din care congelat": l.to_freezer_qty ?? 0,
    "Rebut": l.scrap_qty ?? 0,
    "Rețetă": l.recipe_version ? `v${l.recipe_version}` : "fără",
  }));
  const raw = order.consumption.map((c) => ({
    "Cod SAGA": c.saga_code ?? "NEASOCIAT",
    "Denumire": c.name,
    "UM": c.unit.toUpperCase(),
    "Cantitate consumată": c.actual_qty ?? c.theoretical_qty,
    "Sursă cantitate": c.actual_qty != null ? "efectiv" : "teoretic (rețetă)",
    "Preț unitar": c.unit_cost ?? "",
    "Valoare": c.unit_cost != null ? Math.round((c.actual_qty ?? c.theoretical_qty) * c.unit_cost * 100) / 100 : "",
  }));

  const ws = XLSX.utils.aoa_to_sheet([
    [`Document de producție #${order.id}`],
    [`Data: ${order.planned_for}   Gestiune: ${order.location}${order.freezer ? `   Congelare: ${order.freezer}` : ""}`],
    [`Aprobat de: ${order.approved_by ?? "—"}`],
    [],
    ["PRODUSE FINITE OBȚINUTE"],
  ]);
  XLSX.utils.sheet_add_json(ws, fin, { origin: "A6" });
  const next = 6 + fin.length + 3;
  XLSX.utils.sheet_add_aoa(ws, [["MATERII PRIME CONSUMATE"]], { origin: `A${next - 1}` });
  XLSX.utils.sheet_add_json(ws, raw, { origin: `A${next}` });
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 6 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Productie");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.production", entity: "production_order", entityId: order.id });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Productie_${order.id}_${order.planned_for}.xlsx"`,
    },
  });
}
