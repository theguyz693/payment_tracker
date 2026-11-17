// Append-only audit trail of financial side effects. Writes take the
// caller's session, so an audit entry commits (or rolls back) together with
// the change it describes.

import "server-only";
import { ObjectId, type ClientSession } from "mongodb";
import { auditCollection } from "./models";

export interface AuditEntry {
  userId: string;
  action: string;
  entity: { kind: string; id: string };
  summary: string;
  requestId?: string | null;
  eventId?: ObjectId | null;
}

export async function recordAudit(entry: AuditEntry, session?: ClientSession): Promise<void> {
  await auditCollection().insertOne(
    {
      _id: new ObjectId(),
      at: new Date(),
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      summary: entry.summary,
      requestId: entry.requestId ?? null,
      eventId: entry.eventId ?? null,
    },
    { session },
  );
}

export async function listAudit(userId: string, filter: { eventId?: ObjectId; entityId?: string } = {}, limit = 50) {
  const q: Record<string, unknown> = { userId };
  if (filter.eventId) q.eventId = filter.eventId;
  if (filter.entityId) q["entity.id"] = filter.entityId;
  return auditCollection().find(q).sort({ at: -1 }).limit(limit).toArray();
}
