import Link from "next/link";
import { RequestDecision } from "@/components/integrations/Controls";
import { formatTime } from "@/components/integrations/display";
import { Card, CardTitle, EmptyBlock, Pill, Table, btnSecondary } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { listPaymentRequests } from "@/server/integrations/queries";
import { getTimeZone, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment requests · Integrations" };

const TONE = { PENDING: "pending", ACCEPTED: "gain", REJECTED: "neutral" } as const;

export default async function RequestsPage() {
  const user = await requireUser();
  const [tz, rows] = await Promise.all([getTimeZone(), listPaymentRequests(user.id)]);
  const pending = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status !== "PENDING");

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          hint="Accepting pays the request (simulated) and records it once in your transactions. Rejecting records nothing. Each request can be decided only once."
          action={
            <Link href="/integrations/simulate?tab=request" className={btnSecondary}>
              Simulate a request
            </Link>
          }
        >
          Waiting for you
        </CardTitle>
        {pending.length === 0 ? (
          <EmptyBlock title="No pending requests" hint="Simulate one from a demo contact to try the accept / reject flow." />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.contactName} requests <span className="num">{formatINR(r.amountPaise)}</span>
                  </div>
                  <div className="text-xs text-ink-3">
                    {r.message ?? "No message"}
                    {r.contactVpa && ` · ${r.contactVpa}`} · {formatTime(r.createdAt, tz)} ·{" "}
                    <Link href={`/integrations/events/${r.eventId}`} className="underline">
                      event
                    </Link>
                  </div>
                </div>
                <RequestDecision id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">History</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-ink-3">No decided requests yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Contact</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th className="hidden sm:table-cell">Timeline</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.contactName}</div>
                    <div className="text-xs text-ink-3">{r.message}</div>
                  </td>
                  <td className="num text-right">{formatINR(r.amountPaise)}</td>
                  <td>
                    <Pill tone={TONE[r.status]}>{r.status.toLowerCase()}</Pill>
                  </td>
                  <td className="hidden text-xs text-ink-3 sm:table-cell">{r.history.map((h) => `${h.status.toLowerCase()} ${formatTime(h.at, tz)}`).join(" → ")}</td>
                  <td className="text-xs">
                    {r.transactionId ? (
                      <Link href={`/transactions/${r.transactionId}/edit`} className="underline">
                        Transaction
                      </Link>
                    ) : (
                      <span className="text-ink-3">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
