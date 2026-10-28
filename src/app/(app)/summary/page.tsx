import Link from "next/link";
import { EmptyState } from "@/components/TransactionItem";
import { StatCard, plural } from "@/components/StatCard";
import { ArrowIn, ArrowOut, ChevronLeft, ChevronRight } from "@/components/icons";
import { ChartIllustration } from "@/components/Illustrations";
import { formatDate, formatMonth, isValidMonth, monthKey, shiftMonth } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { monthlySummary } from "@/lib/summary";
import { loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monthly summary" };

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser();
  const today = await getToday();
  const current = monthKey(today);
  const { month: m } = await searchParams;
  const month = isValidMonth(m) ? m : current;
  const { transactions, settlements } = await loadUserData(user.id);
  const s = monthlySummary(transactions, settlements, month, today);
  const isCurrent = month === current;
  const pendingTotal = s.pendingPay.totalPaise;
  const overdueTotal = s.overduePay.totalPaise;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Monthly summary</h1>
        <nav className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1" aria-label="Month">
          <Link
            href={`/summary?month=${shiftMonth(month, -1)}`}
            className="press rounded-md p-1.5 text-ink-2 hover:bg-canvas hover:text-ink"
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold">{formatMonth(month)}</span>
          <Link
            href={`/summary?month=${shiftMonth(month, 1)}`}
            className="press rounded-md p-1.5 text-ink-2 hover:bg-canvas hover:text-ink"
            aria-label="Next month"
          >
            <ChevronRight />
          </Link>
          {!isCurrent && (
            <Link href="/summary" className="press fade-in rounded-md px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-canvas">
              This month
            </Link>
          )}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Totals">
        <StatCard index={0} label="Total paid" paise={s.paid.totalPaise} sub={plural(s.paid.count, "payment")} tone="pay" />
        <StatCard
          index={1}
          label="Total received"
          paise={s.received.totalPaise}
          sub={plural(s.received.count, "payment")}
          tone="receive"
        />
        <StatCard
          index={2}
          label="Net cash flow"
          paise={s.netCashFlow}
          signed
          sub="Received − paid"
          tone={s.netCashFlow >= 0 ? "receive" : "overdue"}
        />
        <StatCard
          index={3}
          label="Total pending"
          paise={pendingTotal}
          sub={
            s.pendingReceive.totalPaise
              ? `to pay, plus ${formatINR(s.pendingReceive.totalPaise)} to receive`
              : `${plural(s.pendingPay.count, "payment")} still due`
          }
        />
        <StatCard
          index={4}
          label="Total overdue"
          paise={overdueTotal}
          sub={
            s.overdueReceive.totalPaise
              ? `to pay, plus ${formatINR(s.overdueReceive.totalPaise)} owed to you`
              : plural(s.overduePay.count, "payment") + " late"
          }
          tone={overdueTotal || s.overdueReceive.totalPaise ? "overdue" : "neutral"}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <section aria-labelledby="by-category">
          <h2 id="by-category" className="mb-3 text-lg font-bold">
            Where the money went
          </h2>
          {s.categories.length === 0 ? (
            <EmptyState illustration={<ChartIllustration />} title={`No payments made in ${formatMonth(month)}.`} />
          ) : (
            <ul className="space-y-3 rounded-xl border border-line bg-surface p-4">
              {s.categories.map((c, i) => (
                <li key={c.name} title={`${c.name}: ${formatINR(c.totalPaise)} (${Math.round(c.share * 100)}%)`}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="num text-ink-2">
                      <span className="font-semibold text-ink">{formatINR(c.totalPaise)}</span>{" "}
                      <span className="text-xs">{Math.round(c.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-canvas">
                    <div
                      className="bar-grow h-2 rounded-full bg-pay"
                      style={{ width: `${Math.max(c.share * 100, 1.5)}%`, "--i": i } as React.CSSProperties}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity">
          <h2 id="activity" className="mb-3 text-lg font-bold">
            Paid and received
          </h2>
          {s.settlements.length === 0 ? (
            <EmptyState title="No activity this month." hint="Items you mark as paid or received show up here." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {s.settlements.map((x, i) => (
                <li
                  key={x.id}
                  className="rise flex items-center gap-3 px-4 py-2.5 text-sm"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-md ${
                      x.direction === "PAY" ? "bg-pay-soft text-pay-strong" : "bg-receive-soft text-receive-strong"
                    }`}
                    aria-label={x.direction === "PAY" ? "Paid" : "Received"}
                  >
                    {x.direction === "PAY" ? <ArrowOut width={13} height={13} /> : <ArrowIn width={13} height={13} />}
                  </span>
                  <Link href={`/transactions/${x.transactionId}/edit`} className="min-w-0 flex-1 truncate hover:underline">
                    {x.title}
                    <span className="ml-2 text-xs text-ink-3">{x.categoryName}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-ink-3">{formatDate(x.settledOn, today)}</span>
                  <span
                    className={`num w-24 shrink-0 text-right font-semibold ${
                      x.direction === "RECEIVE" ? "text-receive-strong" : "text-ink"
                    }`}
                  >
                    {x.direction === "RECEIVE" ? "+" : "−"}
                    {formatINR(x.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
