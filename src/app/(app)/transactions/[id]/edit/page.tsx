import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { DirectionBadge, StatusBadge } from "@/components/Badges";
import { RestoreButton } from "@/components/ItemActions";
import { TransactionForm } from "@/components/TransactionForm";
import { Card, CardTitle, Pill, btnSecondary } from "@/components/ui";
import { Landmark, Pause, Play, ReceiptIcon } from "@/components/icons";
import { addDays, formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { annualCost, describeRecurrence, monthlyCost, occurrencesBetween } from "@/lib/recurrence";
import { effectiveStatus } from "@/lib/status";
import { pauseAction, resumeAction } from "@/server/actions";
import { getHistory, getTransaction, listCategories } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit" };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Scoped to the signed-in user: another user's id is simply "not found".
  const [tx, history] = await Promise.all([getTransaction(user.id, id), getHistory(user.id, id)]);
  if (!tx) notFound();
  const categories = listCategories();
  const today = await getToday();
  const verb = tx.direction === "PAY" ? "Paid" : "Received";
  const recurring = tx.frequency !== "ONE_TIME";
  const active = tx.status === "PENDING" && !tx.archived;
  const preview = active && !tx.paused ? occurrencesBetween(tx, tx.dueDate < today ? tx.dueDate : today, addDays(today, 400), 6) : [];

  const pause = async () => {
    "use server";
    return pauseAction(id);
  };
  const resume = async () => {
    "use server";
    return resumeAction(id);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <DirectionBadge direction={tx.direction} />
          {tx.paused ? <Pill>Paused</Pill> : <StatusBadge status={effectiveStatus(tx, today)} />}
          {tx.loanId && (
            <Link href={`/loans/${tx.loanId}`}>
              <Pill tone="out">
                <Landmark width={11} height={11} /> Loan EMI
              </Pill>
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Edit {tx.title}</h1>
      </div>

      {tx.archived && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-ink-2">This item is deleted and hidden from your dashboard and totals.</span>
          <RestoreButton id={tx.id} title={tx.title} inRow={false} />
        </div>
      )}

      {recurring && active && (
        <Card>
          <CardTitle
            hint={describeRecurrence(tx.frequency, tx.anchorDate)}
            action={
              tx.paused ? (
                <ActionButton run={resume} className={btnSecondary}>
                  <Play width={13} height={13} /> Resume
                </ActionButton>
              ) : (
                <ActionButton
                  run={pause}
                  className={btnSecondary}
                  confirm={{
                    title: `Pause ${tx.title}?`,
                    body: "It won't show as due or overdue, and it's left out of forecasts. When you resume, it continues at the next date; occurrences in between are skipped, not owed.",
                    label: "Pause",
                    tone: "neutral",
                  }}
                >
                  <Pause width={13} height={13} /> Pause
                </ActionButton>
              )
            }
          >
            Recurring
          </CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-ink-2">Cost estimate</div>
              <div className="num mt-1 text-lg font-bold">
                {formatINR(monthlyCost(tx.amountPaise, tx.frequency))}
                <span className="text-sm font-medium text-ink-3"> /month</span>
              </div>
              <div className="num text-xs text-ink-3">{formatINR(annualCost(tx.amountPaise, tx.frequency))} a year</div>
            </div>
            <div>
              <div className="text-xs font-medium text-ink-2">{tx.paused ? "Paused" : "Upcoming"}</div>
              {tx.paused ? (
                <p className="mt-1 text-sm text-ink-3">Nothing is due while paused.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {preview.map((d, i) => (
                    <li key={d} className="flex justify-between gap-2">
                      <span className={d < today ? "font-semibold text-overdue" : i === 0 ? "font-semibold" : "text-ink-2"}>{formatDate(d, today)}</span>
                      <span className="num text-ink-3">{formatINR(tx.amountPaise)}</span>
                    </li>
                  ))}
                  {tx.endDate && <li className="pt-1 text-xs text-ink-3">Ends {formatDate(tx.endDate, today)}</li>}
                </ul>
              )}
            </div>
          </div>
          {tx.amountChanges.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1.5 text-xs font-medium text-ink-2">Price changes</div>
              <ul className="space-y-1 text-sm">
                {[...tx.amountChanges].reverse().map((c, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-ink-2">{formatDate(c.changedOn, today)}</span>
                    <span className="num">
                      {formatINR(c.fromPaise)} → <strong>{formatINR(c.toPaise)}</strong>
                      <span className={`ml-2 text-xs ${c.toPaise > c.fromPaise ? "text-loss" : "text-gain"}`}>
                        {c.toPaise > c.fromPaise ? "+" : "−"}
                        {formatINR(Math.abs(c.toPaise - c.fromPaise))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <TransactionForm categories={categories} today={today} initial={tx} returnTo="/transactions" />

      <section>
        <h2 className="mb-3 text-lg font-bold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing {verb.toLowerCase()} yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {history.map((h, i) => (
              <li key={h.id} className="rise flex items-center justify-between gap-3 px-4 py-2.5 text-sm" style={{ "--i": i } as React.CSSProperties}>
                <span>
                  {verb} {formatDate(h.settledOn, today)}
                  <span className="ml-2 text-ink-3">for the {formatDate(h.dueDate, today)} due date</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num font-semibold">{formatINR(h.amountPaise)}</span>
                  {h.entryId && (
                    <Link href={`/receipts/${h.entryId}`} className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-canvas hover:text-ink" aria-label={`Receipt for ${formatDate(h.settledOn, today)}`}>
                      <ReceiptIcon width={13} height={13} /> Receipt
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
