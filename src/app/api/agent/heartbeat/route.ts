import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agents";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Semnalul de viață al agentului. Corpul JSON opțional descrie starea locală:
 * { version, queued, rejected, sources: [{ type, folder, ok, message }], lastError }.
 */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: "Token agent invalid sau dezactivat." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object") {
    const status = JSON.stringify(body).slice(0, 8000);
    await q("UPDATE sync_agents SET status = $2::text::jsonb WHERE id = $1", [agent.id, status]);
  }
  return NextResponse.json({ ok: true, agent: agent.name, serverTime: new Date().toISOString() });
}
