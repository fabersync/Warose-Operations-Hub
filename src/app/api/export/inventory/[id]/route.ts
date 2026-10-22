import * as XLSX from "xlsx";
import { getUser, canAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getCount, getCountLines } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Raportul de inventar pentru contabilitate: scriptic, faptic, diferențe și valoare. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !canAccess(user, "inventory")) return new Response("Neautorizat", { status: 401 });
  const count = await getCount(user, Number((await params).id));
  if (!count || count.status !== "closed") return new Response("Inventar inexistent sau neînchis", { status: 404 });
  const lines = await getCountLines(count.id);
  const asOf = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }).format(new Date(count.as_of));

  const rows = lines.map((l) => {
    const diff = l.counted_qty === null ? null : l.counted_qty - l.book_qty;
    return {
      "Produs": l.product,
      "UM": l.unit,
      "Stoc scriptic": l.book_qty,
      "Stoc faptic": l.counted_qty ?? "nenumărat",
      "Diferență": diff ?? "",
      "Preț vânzare cu TVA": l.unit_value ?? "",
      "Valoare diferență": diff !== null && l.unit_value != null ? Math.round(diff * l.unit_value * 100) / 100 : "",
      "Numărat de": l.counted_by ?? "",
    };
  });
  const ws = XLSX.utils.aoa_to_sheet([
    [`Inventar #${count.id} — ${count.location}`],
    [`Data inventarului: ${asOf}`],
    [`Deschis de: ${count.started_by} · Închis de: ${count.closed_by ?? "—"}`],
    ["Stoc scriptic = stoc operațional Warose Operations Hub (nu stocul contabil SAGA C)."],
    [],
  ]);
  XLSX.utils.sheet_add_json(ws, rows, { origin: "A6" });
  ws["!cols"] = [{ wch: 42 }, { wch: 6 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 18 }, { wch: 17 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventar");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await audit({ userId: user.id, action: "export.inventory", entity: "inventory_count", entityId: count.id });
  const name = `Inventar_${count.location.replace(/[^A-Za-z0-9]+/g, "_")}_${new Date(count.as_of).toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
