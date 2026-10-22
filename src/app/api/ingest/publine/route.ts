import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agents";
import { ingestPublineSales } from "@/lib/imports";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Primește un export Publine de la agentul de sincronizare instalat pe PC-ul din locație.
 * multipart/form-data, câmp „file”; autentificare: Authorization: Bearer <token agent>.
 * Răspunsul este idempotent: un fișier deja importat întoarce status „duplicate”, iar liniile
 * deja existente din exporturi suprapuse sunt ignorate prin cheia unică a liniei.
 */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: "Token agent invalid sau dezactivat." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Lipsește fișierul (câmpul „file”)." }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "Fișier prea mare (max. 50 MB)." }, { status: 413 });

  const result = await ingestPublineSales({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    defaultLocationId: agent.location_id,
    agentId: agent.id,
  });
  await q("UPDATE sync_agents SET last_upload_at=now(), last_status=$2 WHERE id=$1", [
    agent.id,
    result.status === "failed" ? `Eroare: ${result.error}` : result.status === "duplicate" ? "Fișier deja importat" : `OK: ${result.rowsInserted} linii noi`,
  ]);
  return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
}
