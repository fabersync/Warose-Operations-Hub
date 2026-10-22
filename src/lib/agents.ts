import "server-only";
import crypto from "node:crypto";
import { one, q } from "./db";

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const newAgentToken = () => "wrs_" + crypto.randomBytes(24).toString("base64url");

export async function authenticateAgent(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const agent = await one<{ id: number; name: string; location_id: number }>(
    "SELECT id, name, location_id FROM sync_agents WHERE token_hash=$1 AND active",
    [hashToken(token)],
  );
  if (agent) {
    await q("UPDATE sync_agents SET last_seen_at=now(), agent_version=coalesce($2, agent_version) WHERE id=$1", [
      agent.id,
      req.headers.get("x-agent-version"),
    ]);
  }
  return agent ?? null;
}
