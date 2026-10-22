import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agents";
import { importEInvoice } from "@/lib/invoices";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Primește o factură e-Factura (XML UBL) citită de agent din folderul în care SAGA salvează facturile primite.
 * Doar citire și raportare: nimic nu se scrie înapoi în SAGA. Factura intră „De verificat” în aplicație.
 * multipart/form-data: file (XML), spv_index (opțional), source_path (opțional, pentru jurnal).
 * Locația implicită este cea a agentului (configurată explicit în Setări), nu dedusă din furnizor.
 */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: "Token agent invalid sau dezactivat." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Lipsește fișierul (câmpul „file”)." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Fișier prea mare (max. 10 MB)." }, { status: 413 });
  const spv = String(form?.get("spv_index") ?? "").trim();

  const result = await importEInvoice(Buffer.from(await file.arrayBuffer()), file.name, null, {
    agentId: agent.id,
    locationId: agent.location_id,
    spvIndex: /^\d{6,}$/.test(spv) ? spv : null,
  });
  await q("UPDATE sync_agents SET last_upload_at=now(), last_status=$2 WHERE id=$1", [
    agent.id, `e-Factura ${result.status === "imported" ? "importată" : result.status === "duplicate" ? "deja importată" : "respinsă"}: ${file.name}`,
  ]);
  return NextResponse.json(result, { status: result.status === "error" ? 422 : 200 });
}
