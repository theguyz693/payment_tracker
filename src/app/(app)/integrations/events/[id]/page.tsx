import Link from "next/link";
import { notFound } from "next/navigation";
import { EventActions } from "@/components/integrations/Controls";
import { PaymentPill, ProviderName, StatusPill, formatTime } from "@/components/integrations/display";
import { Card, CardTitle, Note, Pill, Table } from "@/components/ui";
import { EVENT_TYPE_LABEL } from "@/lib/integrations/types";
import { formatINR } from "@/lib/money";
import { getEventDetail } from "@/server/integrations/queries";
import { getTimeZone, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event · Integrations" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [d, tz] = await Promise.all([getEventDetail(user.id, id), getTimeZone()]);
  if (!d) notFound();
  const e = d.row;
  const leaseActive = e.status === "PROCESSING" && e.leaseUntil && new Date(e.leaseUntil) > new Date();
  const canRetry = e.status === "FAILED" || e.status === "RETRY_PENDING" || (e.status === "PROCESSING" && !leaseActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/integrations/events" className="text-xs font-semibold text-ink-3 hover:text-ink">
            ← Event console
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold">
            {EVENT_TYPE_LABEL[e.eventType]} <StatusPill status={e.status} /> <PaymentPill status={e.paymentStatus} />
          </h2>
          <p className="mt-1 font-mono text-xs break-all text-ink-3">{e.externalEventId}</p>
        </div>
        <EventActions id={e.id} canRetry={canRetry} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Summary</CardTitle>
          <dl className="space-y-1.5 text-sm">
            <Item k="Provider" v={<ProviderName id={e.provider} />} />
            <Item k="Direction" v={e.direction === "OUTBOUND" ? "Outgoing" : "Incoming"} />
            <Item k="Delivered via" v={e.source === "WEBHOOK" ? "Signed webhook" : "In-app simulator (signed)"} />
            <Item k="Amount" v={e.amountPaise !== null ? <span className="num">{formatINR(e.amountPaise)}</span> : "—"} />
            <Item k="Received" v={formatTime(e.receivedAt, tz)} />
            <Item k="Processed" v={e.processedAt ? formatTime(e.processedAt, tz) : "—"} />
            <Item k="Processing time" v={e.durationMs !== null ? `${e.durationMs} ms` : "—"} />
            <Item k="Attempts" v={String(e.attemptCount)} />
            {e.nextRetryAt && <Item k="Next retry" v={formatTime(e.nextRetryAt, tz)} />}
            {leaseActive && <Item k="Lease held until" v={formatTime(e.leaseUntil!, tz)} />}
          </dl>
        </Card>

        <Card>
          <CardTitle>What happened</CardTitle>
          <ol className="space-y-3 text-sm">
            <Step ok label="Authenticated" detail="HMAC signature and timestamp verified." />
            <Step ok label="Validated" detail="Payload matched the provider schema and was normalised." />
            <Step
              ok
              label="Idempotency"
              detail={
                e.duplicateCount > 0
                  ? `First delivery accepted. ${e.duplicateCount} repeat deliver${e.duplicateCount === 1 ? "y was" : "ies were"} blocked${d.duplicateLastAt ? ` (last ${formatTime(d.duplicateLastAt, tz)})` : ""}.`
                  : "First delivery of this event id: accepted."
              }
            />
            <Step
              ok={e.status === "PROCESSED"}
              pending={e.status !== "PROCESSED" && e.status !== "FAILED"}
              label="Processing outcome"
              detail={e.outcome?.message ?? e.lastError?.message ?? (e.status === "PROCESSING" ? "In progress (or abandoned until its lease expires)." : "Not processed yet.")}
            />
            {d.linkedLabel && (
              <Step
                ok
                label="Linked record"
                detail={
                  d.linkedLabel.href ? (
                    <Link href={d.linkedLabel.href} className="underline">
                      {d.linkedLabel.label}
                    </Link>
                  ) : (
                    d.linkedLabel.label
                  )
                }
              />
            )}
          </ol>
          {e.lastError && e.status !== "PROCESSED" && (
            <div className="mt-4">
              <Note tone="warn">
                {e.lastError.category}: {e.lastError.message}
              </Note>
            </div>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Attempts</h2>
        {d.attempts.length === 0 ? (
          <p className="text-sm text-ink-3">No processing attempts recorded yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Result</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {d.attempts.map((a) => (
                <tr key={`${a.n}-${a.startedAt}`}>
                  <td>{a.n}</td>
                  <td className="text-xs whitespace-nowrap">{formatTime(a.startedAt, tz)}</td>
                  <td className="text-xs">{a.durationMs} ms</td>
                  <td>
                    <Pill tone={a.result === "PROCESSED" ? "gain" : a.result === "FAILED" ? "loss" : "pending"}>{a.result.toLowerCase().replace("_", " ")}</Pill>
                  </td>
                  <td className="text-xs text-ink-2">{a.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint="After validation; amounts in paise">Normalised event</CardTitle>
          <pre className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-relaxed">{JSON.stringify(d.normalized, null, 2)}</pre>
        </Card>
        <Card>
          <CardTitle hint="Exactly as delivered (simulated data; signature headers not stored)">Incoming payload</CardTitle>
          <pre className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-relaxed">{pretty(d.rawPreview)}</pre>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Audit trail</h2>
        {d.audit.length === 0 ? (
          <p className="text-sm text-ink-3">No audit entries.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {d.audit.map((a, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-mono text-xs whitespace-nowrap text-ink-3">{formatTime(a.at, tz)}</span>
                <span className="font-semibold">{a.action}</span>
                <span className="text-ink-2">{a.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/70 py-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function Step({ ok, pending = false, label, detail }: { ok: boolean; pending?: boolean; label: string; detail: React.ReactNode }) {
  const tone = ok ? "bg-gain" : pending ? "bg-pending" : "bg-loss";
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${tone}`} />
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-ink-2">{detail}</div>
      </div>
    </li>
  );
}
