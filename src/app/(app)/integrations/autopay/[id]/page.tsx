import Link from "next/link";
import { notFound } from "next/navigation";
import { AttemptRunner, MandateControls, ResolveAttempt } from "@/components/integrations/Controls";
import { ProviderName, formatTime } from "@/components/integrations/display";
import { Card, CardTitle, Note, Pill, Table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { MAX_MANDATE_ATTEMPTS, nextAttempt } from "@/lib/integrations/rules";
import { formatINR } from "@/lib/money";
import { FREQUENCY_LABEL } from "@/lib/types";
import { getMandate } from "@/server/integrations/queries";
import { getTimeZone, getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mandate · Autopay" };

const TONE = { SUCCESS: "gain", PENDING: "pending", FAILED: "loss" } as const;

export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [data, tz, today] = await Promise.all([getMandate(user.id, id), getTimeZone(), getToday()]);
  if (!data) notFound();
  const { mandate: m, attempts } = data;
  const current = m.nextDue ? attempts.filter((a) => a.dueDate === m.nextDue) : [];
  const next = nextAttempt(current);
  const blockedReason =
    m.status !== "ACTIVE"
      ? `The mandate is ${m.status.toLowerCase()}, so debits will be refused (try one to see the rejection).`
      : !m.nextDue
        ? "No occurrences left."
        : !next.ok
          ? { already_paid: "This occurrence is paid.", pending: "An attempt is pending: resolve it below first.", exhausted: `All ${MAX_MANDATE_ATTEMPTS} attempts for this occurrence failed.` }[next.reason]
          : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/integrations/autopay" className="text-xs font-semibold text-ink-3 hover:text-ink">
            ← Autopay
          </Link>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold">
            {m.name}
            <Pill tone={m.status === "ACTIVE" ? "gain" : m.status === "PAUSED" ? "pending" : "neutral"}>{m.status.toLowerCase()}</Pill>
          </h2>
          <p className="text-sm text-ink-2">
            <span className="num">{formatINR(m.amountPaise)}</span> {FREQUENCY_LABEL[m.frequency].toLowerCase()} to {m.payeeName} · <ProviderName id={m.provider} short /> ·{" "}
            <Link href={`/transactions/${m.transactionId}/edit`} className="underline">
              linked payment item
            </Link>
          </p>
        </div>
        <MandateControls id={m.id} status={m.status} />
      </div>

      <Card>
        <CardTitle hint={m.nextDue ? `Current occurrence: ${formatDate(m.nextDue, today)}. Next attempt: #${next.ok ? next.attemptNo : "—"} of ${MAX_MANDATE_ATTEMPTS}.` : undefined}>
          Simulate the scheduled debit
        </CardTitle>
        <AttemptRunner mandateId={m.id} disabled={m.status === "CANCELLED" || !m.nextDue} reason={blockedReason} />
        <div className="mt-4">
          <Note>
            Debits run when you trigger them here; no background scheduler charges anything. Each attempt has a fixed identity (mandate, due date, attempt number), so a
            repeated delivery is blocked, and at most one attempt per occurrence can succeed.
          </Note>
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Attempt history</h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-ink-3">No attempts yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Occurrence</th>
                <th>Attempt</th>
                <th>Status</th>
                <th className="hidden sm:table-cell">When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.dueDate, today)}</td>
                  <td>#{a.attemptNo}</td>
                  <td>
                    <Pill tone={TONE[a.status]}>{a.status.toLowerCase()}</Pill>
                    {a.failureReason && <div className="mt-0.5 text-xs text-ink-3">{a.failureReason}</div>}
                  </td>
                  <td className="hidden text-xs text-ink-3 sm:table-cell">{formatTime(a.createdAt, tz)}</td>
                  <td className="text-right">
                    {a.status === "PENDING" ? (
                      <ResolveAttempt id={a.id} />
                    ) : (
                      <Link href={`/integrations/events/${a.eventId}`} className="text-xs underline">
                        Event
                      </Link>
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
