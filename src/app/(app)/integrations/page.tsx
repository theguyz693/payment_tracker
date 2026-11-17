import Link from "next/link";
import { ConnectToggle, RequestDecision, ResolvePayment } from "@/components/integrations/Controls";
import { EventTable, PaymentPill, ProviderName } from "@/components/integrations/display";
import { Card, CardTitle, Metric, Pill } from "@/components/ui";
import { PROVIDER_IDS, PROVIDERS } from "@/lib/integrations/types";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { listConnections } from "@/server/integrations/operations";
import { getMetrics, listMandates, listPaymentRequests, recentEvents } from "@/server/integrations/queries";
import { getTimeZone, getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations Hub" };

export default async function IntegrationsOverview() {
  const user = await requireUser();
  const [tz, today] = await Promise.all([getTimeZone(), getToday()]);
  const [connections, metrics, recent, outgoing, pending, mandates, failing] = await Promise.all([
    listConnections(user.id),
    getMetrics(user.id, "7d"),
    recentEvents(user.id, {}, 8),
    recentEvents(user.id, { eventType: { $in: ["payment.debit", "mandate.debit_attempt"] } }, 6),
    listPaymentRequests(user.id, "PENDING", 5),
    listMandates(user.id, { activeOnly: true }),
    recentEvents(user.id, { status: { $in: ["FAILED", "RETRY_PENDING", "PROCESSING"] } }, 5),
  ]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Last 7 days">
        <Metric index={0} label="Events received (7 days)" value={metrics.received} sub={`${metrics.byStatus.PROCESSED} processed`} href="/integrations/events" />
        <Metric index={1} label="Duplicates blocked" value={metrics.duplicatesBlocked} sub="Repeat deliveries ignored" />
        <Metric index={2} label="Failed / retrying" value={metrics.byStatus.FAILED + metrics.byStatus.RETRY_PENDING} tone={metrics.byStatus.RETRY_PENDING ? "pending" : "neutral"} href="/integrations/events?status=RETRY_PENDING" />
        <Metric index={3} label="Avg. processing time" value={metrics.avgDurationMs !== null ? `${metrics.avgDurationMs} ms` : "—"} sub="Processed events" href="/integrations/monitoring" />
      </section>

      <Card>
        <CardTitle hint="Demo accounts only. Connecting creates a random account reference the simulator puts in its payloads; no credentials are involved.">Providers</CardTitle>
        <ul className="divide-y divide-line">
          {PROVIDER_IDS.map((p) => {
            const c = connections[p];
            const on = c?.status === "CONNECTED";
            return (
              <li key={p} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <ProviderName id={p} />
                    <Pill tone={on ? "gain" : "neutral"}>{on ? "Connected (demo)" : "Not connected"}</Pill>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {PROVIDERS[p].description}
                    {on && <span className="ml-1 font-mono">· {c!.accountRef}</span>}
                  </p>
                </div>
                <ConnectToggle provider={p} connected={on} />
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Link href="/integrations/requests" className="text-xs font-semibold text-ink-2 hover:text-ink">All requests</Link>}>Pending payment requests</CardTitle>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-3">
              Nothing waiting. <Link href="/integrations/simulate?tab=request" className="underline">Simulate a request</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-medium">
                      {r.contactName} · <span className="num">{formatINR(r.amountPaise)}</span>
                    </div>
                    {r.message && <div className="text-xs text-ink-3">{r.message}</div>}
                  </div>
                  <RequestDecision id={r.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/integrations/autopay" className="text-xs font-semibold text-ink-2 hover:text-ink">Manage</Link>}>Active autopay mandates</CardTitle>
          {mandates.length === 0 ? (
            <p className="text-sm text-ink-3">
              No active mandates. <Link href="/integrations/autopay" className="underline">Create one</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {mandates.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/integrations/autopay/${m.id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  <span className="text-right text-sm">
                    <span className="num font-semibold">{formatINR(m.amountPaise)}</span>
                    <span className="block text-xs text-ink-3">{m.nextDue ? `Next ${formatDate(m.nextDue, today)}` : "Completed"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle hint="Simulated UPI payments and autopay debits">Recent outgoing payments</CardTitle>
        {outgoing.length === 0 ? (
          <p className="text-sm text-ink-3">
            None yet. <Link href="/integrations/simulate" className="underline">Simulate a payment</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {outgoing.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/integrations/events/${e.id}`} className="font-medium hover:underline">
                    {e.counterparty ?? "Autopay debit"}
                  </Link>
                  <div className="text-xs text-ink-3">
                    <ProviderName id={e.provider} short /> · <span className="font-mono">{e.externalEventId.slice(0, 24)}</span>
                  </div>
                </div>
                <span className="num font-semibold">{e.amountPaise !== null ? formatINR(e.amountPaise) : "—"}</span>
                <PaymentPill status={e.paymentStatus} />
                {e.paymentStatus === "PENDING" && e.eventType === "payment.debit" && <ResolvePayment eventId={e.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {failing.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">Needs attention</h2>
          <EventTable rows={failing} tz={tz} />
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Recent events</h2>
          <Link href="/integrations/events" className="text-xs font-semibold text-ink-2 hover:text-ink">
            Open console
          </Link>
        </div>
        <EventTable rows={recent} tz={tz} empty="No events yet. Connect a demo provider, then use the Simulators tab." />
      </section>
    </div>
  );
}
