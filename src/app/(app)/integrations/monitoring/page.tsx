import Link from "next/link";
import { ProviderName } from "@/components/integrations/display";
import { Card, CardTitle, Metric, Note, Table, Tabs } from "@/components/ui";
import { isProviderId, PROVIDER_IDS, PROVIDERS } from "@/lib/integrations/types";
import { getMetrics, PERIODS, type MetricsPeriod } from "@/server/integrations/queries";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoring · Integrations" };

const REASON_LABEL: Record<string, string> = {
  RATE_LIMITED: "Rate limited",
  INVALID_SIGNATURE: "Bad signature",
  STALE_TIMESTAMP: "Stale timestamp (replay window)",
  INVALID_PAYLOAD: "Invalid payload",
  UNKNOWN_PROVIDER: "Unknown provider",
  UNKNOWN_ACCOUNT: "Unknown / disconnected account",
  FORBIDDEN: "Cross-account attempt",
  PAYLOAD_CONFLICT: "Same id, different contents",
  TOO_LARGE: "Payload too large",
};

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const period: MetricsPeriod = typeof sp.period === "string" && sp.period in PERIODS ? (sp.period as MetricsPeriod) : "7d";
  const provider = isProviderId(sp.provider) ? sp.provider : undefined;
  const m = await getMetrics(user.id, period, provider);
  const href = (p: MetricsPeriod, prov = provider) => `/integrations/monitoring?period=${p}${prov ? `&provider=${prov}` : ""}`;
  const maxDaily = Math.max(1, ...m.daily.map((d) => d.received));
  const successRate = m.received ? Math.round((m.byStatus.PROCESSED / m.received) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={(Object.keys(PERIODS) as MetricsPeriod[]).map((p) => ({ key: p, label: PERIODS[p], href: href(p) }))} active={period} />
        <nav className="flex flex-wrap gap-1 text-xs" aria-label="Provider filter">
          <Link href={href(period, undefined)} aria-current={!provider ? "page" : undefined} className="rounded-full border border-line px-2.5 py-1 text-ink-2 aria-[current=page]:border-ink aria-[current=page]:text-ink">
            All providers
          </Link>
          {PROVIDER_IDS.map((p) => (
            <Link key={p} href={href(period, p)} aria-current={provider === p ? "page" : undefined} className="rounded-full border border-line px-2.5 py-1 text-ink-2 aria-[current=page]:border-ink aria-[current=page]:text-ink">
              {PROVIDERS[p].name.replace(" Simulator", "")}
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric index={0} label="Events received" value={m.received} sub={successRate !== null ? `${successRate}% processed` : undefined} />
        <Metric index={1} label="Processed" value={m.byStatus.PROCESSED} tone="gain" />
        <Metric index={2} label="Failed" value={m.byStatus.FAILED} tone={m.byStatus.FAILED ? "loss" : "neutral"} href="/integrations/events?status=FAILED" />
        <Metric index={3} label="Awaiting retry" value={m.byStatus.RETRY_PENDING + m.byStatus.PROCESSING} tone={m.byStatus.RETRY_PENDING ? "pending" : "neutral"} href="/integrations/events?status=RETRY_PENDING" />
        <Metric index={4} label="Duplicates prevented" value={m.duplicatesBlocked} sub="Repeat deliveries ignored" />
        <Metric index={5} label="Avg. processing time" value={m.avgDurationMs !== null ? `${m.avgDurationMs} ms` : "—"} sub={m.p95DurationMs !== null ? `p95 ${m.p95DurationMs} ms` : undefined} />
        <Metric index={6} label="Rate-limit rejections" value={m.rejections.rateLimited} sub={`${m.rejections.total} rejected request${m.rejections.total === 1 ? "" : "s"} in total`} />
        <Metric index={7} label="Simulated UPI payments" value={m.payments.total} sub={`${m.payments.success} success · ${m.payments.pending} pending · ${m.payments.failed} failed`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Up to the last 14 days in the selected period (UTC days)">Events per day</CardTitle>
          {m.daily.length === 0 ? (
            <p className="text-sm text-ink-3">No events in this period.</p>
          ) : (
            <ul className="space-y-1.5" aria-label="Events per day">
              {m.daily.map((d) => (
                <li key={d.day} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-xs">
                  <span className="text-ink-3">{d.day.slice(5)}</span>
                  <span className="flex h-3 overflow-hidden rounded bg-canvas">
                    <span className="bg-gain" style={{ width: `${((d.received - d.failed) / maxDaily) * 100}%` }} />
                    <span className="bg-loss" style={{ width: `${(d.failed / maxDaily) * 100}%` }} />
                  </span>
                  <span className="num text-right">{d.received}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Autopay attempts</CardTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(
              [
                ["Total", m.autopay.total],
                ["Successful", m.autopay.success],
                ["Pending", m.autopay.pending],
                ["Failed", m.autopay.failed],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-canvas px-3 py-2">
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="num text-lg font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-5 mb-2 text-sm font-semibold">Rejected requests (GateKeeper)</h3>
          {m.rejections.total === 0 ? (
            <p className="text-sm text-ink-3">None in this period.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(m.rejections.byReason).map(([reason, n]) => (
                <li key={reason} className="flex justify-between">
                  <span className="text-ink-2">{REASON_LABEL[reason] ?? reason}</span>
                  <span className="num font-semibold">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">By provider</h2>
        {m.byProvider.length === 0 ? (
          <p className="text-sm text-ink-3">No events in this period.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className="text-right">Received</th>
                <th className="text-right">Processed</th>
                <th className="text-right">Failed</th>
                <th className="text-right">Duplicates blocked</th>
              </tr>
            </thead>
            <tbody>
              {m.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td>
                    <ProviderName id={p.provider} />
                  </td>
                  <td className="num text-right">{p.received}</td>
                  <td className="num text-right">{p.processed}</td>
                  <td className="num text-right">{p.failed}</td>
                  <td className="num text-right">{p.duplicates}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Note>
        Operational metrics for your own simulated integrations, computed from stored events, attempts and rejections. They&apos;re kept separate from your financial
        dashboard.
      </Note>
    </div>
  );
}
