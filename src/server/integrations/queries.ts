// Read models for the Integrations Hub, event console and monitoring page.
// Every query is scoped to the signed-in user. Metrics are computed from
// persisted events, attempts and rejections — nothing is estimated.

import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { EVENT_STATUSES, EVENT_TYPES, isProviderId, type EventStatus, type EventType, type ProviderId } from "@/lib/integrations/types";
import { listAudit } from "../audit";
import {
  attemptsCollection,
  eventsCollection,
  holdingsCollection,
  mandatesCollection,
  paymentRequestsCollection,
  rejectionsCollection,
  transactionsCollection,
  type IntegrationEventDoc,
  type MandateAttemptDoc,
  type MandateDoc,
  type PaymentRequestDoc,
} from "../models";

const toObjectId = (id: string) => (/^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null);

/** Fields safe to send to the browser (no raw body, no hashes). */
export interface EventRow {
  id: string;
  provider: ProviderId;
  externalEventId: string;
  eventType: EventType;
  direction: "INBOUND" | "OUTBOUND";
  source: "SIMULATOR" | "WEBHOOK";
  amountPaise: number | null;
  status: EventStatus;
  paymentStatus: "SUCCESS" | "PENDING" | "FAILED" | null;
  attemptCount: number;
  duplicateCount: number;
  durationMs: number | null;
  receivedAt: string;
  processedAt: string | null;
  nextRetryAt: string | null;
  leaseUntil: string | null;
  outcome: { code: string; message: string } | null;
  lastError: { category: string; message: string } | null;
  linked: IntegrationEventDoc["linked"];
  counterparty: string | null;
}

function counterpartyOf(e: IntegrationEventDoc): string | null {
  const d = (e.normalizedPayload as { data?: Record<string, unknown> }).data ?? {};
  return (d.counterpartyName ?? d.contactName ?? d.symbol ?? null) as string | null;
}

export function toEventRow(e: IntegrationEventDoc): EventRow {
  return {
    id: e._id.toHexString(),
    provider: e.provider,
    externalEventId: e.externalEventId,
    eventType: e.eventType,
    direction: e.direction,
    source: e.source,
    amountPaise: e.amountPaise,
    status: e.status,
    paymentStatus: e.paymentStatus,
    attemptCount: e.attemptCount,
    duplicateCount: e.duplicateCount,
    durationMs: e.durationMs,
    receivedAt: e.receivedAt.toISOString(),
    processedAt: e.processedAt?.toISOString() ?? null,
    nextRetryAt: e.nextRetryAt?.toISOString() ?? null,
    leaseUntil: e.leaseUntil?.toISOString() ?? null,
    outcome: e.outcome,
    lastError: e.lastError,
    linked: e.linked,
    counterparty: counterpartyOf(e),
  };
}

// ---- Event console ----

export interface EventFilters {
  provider?: ProviderId;
  type?: EventType;
  status?: EventStatus;
  from?: string;
  to?: string;
  q?: string;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** URL params -> validated filters (unknown values are ignored, never passed to the database). */
export function parseEventFilters(p: Params): EventFilters {
  const provider = one(p, "provider");
  const type = one(p, "type");
  const status = one(p, "status");
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const q = one(p, "q")?.slice(0, 80);
  const page = Math.min(Math.max(Number(one(p, "page")) || 1, 1), 500);
  return {
    provider: isProviderId(provider) ? provider : undefined,
    type: (EVENT_TYPES as readonly string[]).includes(type ?? "") ? (type as EventType) : undefined,
    status: (EVENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as EventStatus) : undefined,
    from: date(one(p, "from")),
    to: date(one(p, "to")),
    q: q && /^[\w\-:.]+$/.test(q) ? q : undefined,
    page,
  };
}

export const EVENTS_PAGE_SIZE = 25;

export async function listEvents(userId: string, f: EventFilters): Promise<{ rows: EventRow[]; total: number }> {
  const filter: Filter<IntegrationEventDoc> = { userId };
  if (f.provider) filter.provider = f.provider;
  if (f.type) filter.eventType = f.type;
  if (f.status) filter.status = f.status;
  if (f.from || f.to) {
    filter.receivedAt = {
      ...(f.from ? { $gte: new Date(`${f.from}T00:00:00Z`) } : {}),
      ...(f.to ? { $lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
    };
  }
  if (f.q) filter.externalEventId = { $regex: `^${f.q.replace(/[.\-]/g, "\\$&")}`, $options: "i" };
  const col = eventsCollection();
  const [docs, total] = await Promise.all([
    col
      .find(filter, { projection: { rawBody: 0 } })
      .sort({ receivedAt: -1 })
      .skip((f.page - 1) * EVENTS_PAGE_SIZE)
      .limit(EVENTS_PAGE_SIZE)
      .toArray(),
    col.countDocuments(filter),
  ]);
  return { rows: docs.map(toEventRow), total };
}

export interface EventDetail {
  row: EventRow;
  normalized: Record<string, unknown>;
  attempts: { n: number; startedAt: string; durationMs: number; result: string; error: string | null }[];
  duplicateLastAt: string | null;
  audit: { at: string; action: string; summary: string }[];
  linkedLabel: { label: string; href: string | null } | null;
  rawPreview: string;
}

export async function getEventDetail(userId: string, id: string): Promise<EventDetail | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const e = await eventsCollection().findOne({ _id, userId });
  if (!e) return null;
  const audit = await listAudit(userId, { eventId: _id }, 40);
  return {
    row: toEventRow(e),
    normalized: e.normalizedPayload,
    attempts: e.attempts.map((a) => ({ n: a.n, startedAt: a.startedAt.toISOString(), durationMs: a.durationMs, result: a.result, error: a.error })),
    duplicateLastAt: e.lastDuplicateAt?.toISOString() ?? null,
    audit: audit.map((a) => ({ at: a.at.toISOString(), action: a.action, summary: a.summary })),
    linkedLabel: await linkedLabel(userId, e.linked),
    // Simulated payloads only; capped so the page stays small.
    rawPreview: e.rawBody.length > 4000 ? `${e.rawBody.slice(0, 4000)}…` : e.rawBody,
  };
}

async function linkedLabel(userId: string, linked: IntegrationEventDoc["linked"]): Promise<EventDetail["linkedLabel"]> {
  if (!linked) return null;
  const _id = toObjectId(linked.id);
  if (!_id) return null;
  if (linked.kind === "transaction") {
    const t = await transactionsCollection().findOne({ _id, userId }, { projection: { title: 1, status: 1, archivedAt: 1 } });
    return t ? { label: `${t.title} · ${t.archivedAt ? "removed" : t.status.toLowerCase()}`, href: t.archivedAt ? null : `/transactions/${linked.id}/edit` } : null;
  }
  if (linked.kind === "holding") {
    const h = await holdingsCollection().findOne({ _id, userId }, { projection: { name: 1 } });
    return h ? { label: `${h.name} (investments)`, href: `/investments/${linked.id}` } : null;
  }
  if (linked.kind === "paymentRequest") {
    const r = await paymentRequestsCollection().findOne({ _id, userId }, { projection: { contactName: 1, status: 1 } });
    return r ? { label: `Request from ${r.contactName} · ${r.status.toLowerCase()}`, href: "/integrations/requests" } : null;
  }
  const a = await attemptsCollection().findOne({ _id, userId });
  return a ? { label: `Autopay attempt #${a.attemptNo} for ${a.dueDate} · ${a.status.toLowerCase()}`, href: `/integrations/autopay/${a.mandateId.toHexString()}` } : null;
}

export async function getRawBody(userId: string, id: string): Promise<{ provider: ProviderId; body: string } | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const e = await eventsCollection().findOne({ _id, userId }, { projection: { provider: 1, rawBody: 1 } });
  return e ? { provider: e.provider, body: e.rawBody } : null;
}

// ---- Hub ----

export async function recentEvents(userId: string, filter: Filter<IntegrationEventDoc> = {}, limit = 8): Promise<EventRow[]> {
  const docs = await eventsCollection()
    .find({ ...filter, userId }, { projection: { rawBody: 0 } })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toEventRow);
}

export interface RequestRow {
  id: string;
  contactName: string;
  contactVpa: string | null;
  amountPaise: number;
  message: string | null;
  status: PaymentRequestDoc["status"];
  createdAt: string;
  decidedAt: string | null;
  transactionId: string | null;
  eventId: string;
  history: { status: string; at: string }[];
}

const toRequestRow = (r: PaymentRequestDoc): RequestRow => ({
  id: r._id.toHexString(),
  contactName: r.contactName,
  contactVpa: r.contactVpa,
  amountPaise: r.amountPaise,
  message: r.message,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  transactionId: r.transactionId?.toHexString() ?? null,
  eventId: r.eventId.toHexString(),
  history: r.history.map((h) => ({ status: h.status, at: h.at.toISOString() })),
});

export async function listPaymentRequests(userId: string, status?: PaymentRequestDoc["status"], limit = 50): Promise<RequestRow[]> {
  const docs = await paymentRequestsCollection()
    .find({ userId, ...(status ? { status } : {}) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toRequestRow);
}

export interface MandateRow {
  id: string;
  name: string;
  payeeName: string;
  provider: ProviderId;
  amountPaise: number;
  frequency: MandateDoc["frequency"];
  startDate: string;
  endDate: string | null;
  status: MandateDoc["status"];
  transactionId: string;
  nextDue: string | null;
  completed: boolean;
}

export async function listMandates(userId: string, opts: { activeOnly?: boolean } = {}): Promise<MandateRow[]> {
  const docs = await mandatesCollection()
    .find({ userId, ...(opts.activeOnly ? { status: "ACTIVE" } : {}) })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  const txs = await transactionsCollection()
    .find({ userId, _id: { $in: docs.map((d) => d.transactionId) } }, { projection: { dueDate: 1, status: 1 } })
    .toArray();
  return docs.map((m) => {
    const t = txs.find((x) => x._id.equals(m.transactionId));
    return {
      id: m._id.toHexString(),
      name: m.name,
      payeeName: m.payeeName,
      provider: m.provider,
      amountPaise: m.amountPaise,
      frequency: m.frequency,
      startDate: m.startDate,
      endDate: m.endDate,
      status: m.status,
      transactionId: m.transactionId.toHexString(),
      nextDue: t && t.status === "PENDING" ? t.dueDate : null,
      completed: !!t && t.status !== "PENDING",
    };
  });
}

export interface AttemptRow {
  id: string;
  dueDate: string;
  attemptNo: number;
  status: MandateAttemptDoc["status"];
  failureReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  eventId: string;
}

export async function getMandate(userId: string, id: string): Promise<{ mandate: MandateRow; attempts: AttemptRow[] } | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const rows = await listMandates(userId);
  const mandate = rows.find((m) => m.id === id);
  if (!mandate) return null;
  const attempts = await attemptsCollection().find({ userId, mandateId: _id }).sort({ createdAt: -1 }).limit(100).toArray();
  return {
    mandate,
    attempts: attempts.map((a) => ({
      id: a._id.toHexString(),
      dueDate: a.dueDate,
      attemptNo: a.attemptNo,
      status: a.status,
      failureReason: a.failureReason,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      eventId: a.eventId.toHexString(),
    })),
  };
}

// ---- Monitoring ----

export const PERIODS = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" } as const;
export type MetricsPeriod = keyof typeof PERIODS;

export function periodStart(period: MetricsPeriod, now = Date.now()): Date | null {
  const day = 86_400_000;
  return period === "24h" ? new Date(now - day) : period === "7d" ? new Date(now - 7 * day) : period === "30d" ? new Date(now - 30 * day) : null;
}

export interface Metrics {
  received: number;
  byStatus: Record<EventStatus, number>;
  duplicatesBlocked: number;
  payments: { total: number; success: number; pending: number; failed: number };
  autopay: { total: number; success: number; pending: number; failed: number };
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  rejections: { total: number; rateLimited: number; byReason: Record<string, number> };
  byProvider: { provider: ProviderId; received: number; processed: number; failed: number; duplicates: number }[];
  daily: { day: string; received: number; failed: number }[];
}

export async function getMetrics(userId: string, period: MetricsPeriod, provider?: ProviderId): Promise<Metrics> {
  const since = periodStart(period);
  const match: Filter<IntegrationEventDoc> = { userId, ...(provider ? { provider } : {}), ...(since ? { receivedAt: { $gte: since } } : {}) };
  const events = eventsCollection();

  const [statusAgg, providerAgg, payAgg, durations, dailyAgg, rejections, attempts] = await Promise.all([
    events.aggregate<{ _id: EventStatus; n: number; dup: number }>([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 }, dup: { $sum: "$duplicateCount" } } }]).toArray(),
    events
      .aggregate<{ _id: ProviderId; n: number; processed: number; failed: number; dup: number }>([
        { $match: match },
        {
          $group: {
            _id: "$provider",
            n: { $sum: 1 },
            processed: { $sum: { $cond: [{ $eq: ["$status", "PROCESSED"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
            dup: { $sum: "$duplicateCount" },
          },
        },
      ])
      .toArray(),
    events
      .aggregate<{ _id: string | null; n: number }>([
        { $match: { ...match, eventType: { $in: ["payment.debit", "payment.credit"] }, status: "PROCESSED" } },
        { $group: { _id: "$paymentStatus", n: { $sum: 1 } } },
      ])
      .toArray(),
    events
      .find({ ...match, status: "PROCESSED", durationMs: { $ne: null } }, { projection: { durationMs: 1 } })
      .sort({ receivedAt: -1 })
      .limit(2000)
      .toArray(),
    events
      .aggregate<{ _id: string; n: number; failed: number }>([
        { $match: { ...match, receivedAt: { $gte: since && since.getTime() > Date.now() - 14 * 86_400_000 ? since : new Date(Date.now() - 14 * 86_400_000) } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$receivedAt" } },
            n: { $sum: 1 },
            failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    rejectionsCollection()
      .aggregate<{ _id: string; n: number }>([
        { $match: { userId, ...(provider ? { provider } : {}), ...(since ? { at: { $gte: since } } : {}) } },
        { $group: { _id: "$reason", n: { $sum: 1 } } },
      ])
      .toArray(),
    provider && provider !== "autopay_sim"
      ? Promise.resolve([] as { _id: string; n: number }[])
      : attemptsCollection()
          .aggregate<{ _id: string; n: number }>([{ $match: { userId, ...(since ? { createdAt: { $gte: since } } : {}) } }, { $group: { _id: "$status", n: { $sum: 1 } } }])
          .toArray(),
  ]);

  const byStatus = Object.fromEntries(EVENT_STATUSES.map((s) => [s, 0])) as Record<EventStatus, number>;
  let duplicatesBlocked = 0;
  for (const s of statusAgg) {
    byStatus[s._id] = s.n;
    duplicatesBlocked += s.dup;
  }
  const count = (rows: { _id: string | null; n: number }[], k: string) => rows.find((r) => r._id === k)?.n ?? 0;
  const ds = durations.map((d) => d.durationMs!).sort((a, b) => a - b);
  const byReason = Object.fromEntries(rejections.map((r) => [r._id, r.n]));
  return {
    received: statusAgg.reduce((a, s) => a + s.n, 0),
    byStatus,
    duplicatesBlocked,
    payments: {
      total: payAgg.reduce((a, r) => a + r.n, 0),
      success: count(payAgg, "SUCCESS"),
      pending: count(payAgg, "PENDING"),
      failed: count(payAgg, "FAILED"),
    },
    autopay: {
      total: attempts.reduce((a, r) => a + r.n, 0),
      success: count(attempts, "SUCCESS"),
      pending: count(attempts, "PENDING"),
      failed: count(attempts, "FAILED"),
    },
    avgDurationMs: ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null,
    p95DurationMs: ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))] : null,
    rejections: { total: rejections.reduce((a, r) => a + r.n, 0), rateLimited: byReason.RATE_LIMITED ?? 0, byReason },
    byProvider: providerAgg.map((p) => ({ provider: p._id, received: p.n, processed: p.processed, failed: p.failed, duplicates: p.dup })),
    daily: dailyAgg.map((d) => ({ day: d._id, received: d.n, failed: d.failed })),
  };
}
