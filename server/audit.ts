import { sql, type Db } from './db.ts';

export async function audit(
  entry: {
    actor?: string | null;
    businessId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string;
  },
  db: Db = sql,
) {
  // Hassas bilgileri (şifre, token, kod) metadata'ya asla koymayın.
  await db`
    INSERT INTO audit_logs (actor_user_id, business_id, action, target_type, target_id, metadata, ip)
    VALUES (${entry.actor ?? null}, ${entry.businessId ?? null}, ${entry.action}, ${entry.targetType ?? null},
            ${entry.targetId ?? null}, ${db.json((entry.metadata ?? {}) as never)}, ${entry.ip ?? null})`;
}
