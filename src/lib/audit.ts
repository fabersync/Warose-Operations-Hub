import "server-only";
import { q, type Query } from "./db";

export async function audit(
  entry: { userId?: number | null; agentId?: number | null; action: string; entity?: string; entityId?: string | number; details?: unknown },
  query: Query = q,
) {
  await query(
    "INSERT INTO audit_log (user_id, agent_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6::text::jsonb)",
    [
      entry.userId ?? null,
      entry.agentId ?? null,
      entry.action,
      entry.entity ?? null,
      entry.entityId != null ? String(entry.entityId) : null,
      entry.details != null ? JSON.stringify(entry.details) : null,
    ],
  );
}
