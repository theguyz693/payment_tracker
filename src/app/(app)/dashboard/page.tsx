import Link from "next/link";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { AllClearIllustration } from "@/components/Illustrations";
import { LastUpdated } from "@/components/LastUpdated";
import { StatCard, plural } from "@/components/StatCard";
import { EmptyState, TransactionItem } from "@/components/TransactionItem";
import { ArrowIn, ArrowOut, ArrowRight, Plus } from "@/components/icons";
import { addDays, formatDate, formatMonth } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { dashboardSummary, openItems } from "@/lib/summary";
import type { Direction, ISODate, Transaction } from "@/lib/types";
import { loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const today = await getToday();
  const { transactions, settlements } = await loadUserData(user.id);
  const s = dashboardSummary(transactions, settlements, today);
  const monthName = formatMonth(s.month).split(" ")[0];
  const firstName = user.name.split(" ")[0];
  const isNew = transactions.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isNew && firstName ? `Welcome, ${firstName}` : "What's happening with your money"}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {isNew
              ? "Add the payments you need to make and the money you're expecting. This page keeps track of what's due."
              : `Today is ${formatDate(today)}. Totals cover the next 30 days, plus anything overdue.`}
          </p>
        </div>
        <LastUpdated at={new Date().toISOString()} />
      </div>

      {/* Hero: owe vs. owed */}
      <section aria-label="Next 30 days" className="grid overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
        <HeroPanel direction="PAY" total={s.horizon.pay.totalPaise} count={s.horizon.pay.count} overdue={s.overduePay.totalPaise} />
        <HeroPanel
          direction="RECEIVE"
          total={s.horizon.receive.totalPaise}
          count={s.horizon.receive.count}
          overdue={s.overdueReceive.totalPaise}
        />
      </section>

      {/* Stat cards */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          index={0}
          label="Due today"
          paise={s.dueToday.totalPaise}
          sub={s.dueToday.count ? plural(s.dueToday.count, "payment") : "Nothing due today 🎉"}
          tone="pay"
        />
        <StatCard
          index={1}
          label="Due this week"
          paise={s.dueThisWeek.totalPaise}
          sub={s.dueThisWeek.count ? plural(s.dueThisWeek.count, "payment") : "All clear for 7 days"}
          tone="pay"
        />
        <StatCard
          index={2}
          label="Upcoming payments"
          paise={s.upcoming.totalPaise}
          sub={`${plural(s.upcoming.count, "payment")} in 30 days`}
        />
        <StatCard
          index={3}
          label="Overdue"
          paise={s.overduePay.totalPaise}
          sub={
            s.overduePay.count || s.overdueReceive.count
              ? `${plural(s.overduePay.count, "payment")} late` +
                (s.overdueReceive.count ? `, ${formatINR(s.overdueReceive.totalPaise)} owed to you` : "")
              : "Nothing overdue"
          }
          tone={s.overduePay.count || s.overdueReceive.count ? "overdue" : "neutral"}
        />
        <StatCard
          index={4}
          label="To receive"
          paise={s.toReceive.totalPaise}
          sub={s.toReceive.count ? plural(s.toReceive.count, "payment") + " expected" : "No pending money to receive"}
          tone="receive"
        />
        <StatCard index={5} label={`Paid in ${monthName}`} paise={s.paidThisMonth.totalPaise} sub={plural(s.paidThisMonth.count, "payment")} />
        <StatCard
          index={6}
          label={`Received in ${monthName}`}
          paise={s.receivedThisMonth.totalPaise}
          sub={plural(s.receivedThisMonth.count, "payment")}
        />
        <StatCard index={7} label={`${monthName} expenses`} paise={s.expensesThisMonth.totalPaise} sub="Paid + still due this month" />
        <StatCard
          index={8}
          label={`Net cash flow, ${monthName}`}
          paise={s.netCashFlow}
          signed
          sub="Received − paid"
          tone={s.netCashFlow >= 0 ? "receive" : "overdue"}
        />
        <Link
          href="/summary"
          className="rise press group flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm font-semibold text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink"
          style={{ "--i": 9 } as React.CSSProperties}
        >
          See monthly summary
          <ArrowRight width={14} height={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </section>

      {/* Lists */}
      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <DueList
          direction="PAY"
          items={openItems(transactions, "PAY")}
          today={today}
          empty="No payments due 🎉"
          emptyHint="Add rent, EMIs or bills to see them here."
        />
        <DueList
          direction="RECEIVE"
          items={openItems(transactions, "RECEIVE")}
          today={today}
          empty="No pending money to receive."
          emptyHint="Track rent from tenants, salary or money someone owes you."
        />
      </div>
    </div>
  );
}

function HeroPanel({ direction, total, count, overdue }: { direction: Direction; total: number; count: number; overdue: number }) {
  const pay = direction === "PAY";
  return (
    <div
      className={`rise px-5 py-5 sm:px-6 ${pay ? "bg-pay-soft" : "border-t border-line bg-receive-soft sm:border-t-0 sm:border-l"}`}
      style={{ "--i": pay ? 0 : 1 } as React.CSSProperties}
    >
      <div className={`flex items-center gap-1.5 text-sm font-semibold ${pay ? "text-pay-strong" : "text-receive-strong"}`}>
        {pay ? <ArrowOut /> : <ArrowIn />}
        {pay ? "You need to pay" : "You'll receive"}
      </div>
      <div className="num mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">
        <AnimatedNumber paise={total} />
      </div>
      <div className="mt-2 text-sm text-ink-2">
        {count ? plural(count, "payment") : pay ? "Nothing to pay" : "Nothing expected"}
        {overdue > 0 && (
          <span className="ml-2 inline-flex rounded-full bg-overdue px-2 py-0.5 text-xs font-semibold text-white">
            {formatINR(overdue)} overdue
          </span>
        )}
      </div>
    </div>
  );
}

function DueList({
  direction,
  items,
  today,
  empty,
  emptyHint,
}: {
  direction: Direction;
  items: Transaction[];
  today: ISODate;
  empty: string;
  emptyHint: string;
}) {
  const weekEnd = addDays(today, 6);
  const horizon = addDays(today, 30);
  const groups: { label: string; items: Transaction[]; danger?: boolean }[] = [
    { label: "Overdue", items: items.filter((t) => t.dueDate < today), danger: true },
    { label: "Due today", items: items.filter((t) => t.dueDate === today) },
    { label: "This week", items: items.filter((t) => t.dueDate > today && t.dueDate <= weekEnd) },
    { label: "Next 30 days", items: items.filter((t) => t.dueDate > weekEnd && t.dueDate <= horizon) },
  ].filter((g) => g.items.length);
  const beyond = items.filter((t) => t.dueDate > horizon).length;
  const pay = direction === "PAY";
  let index = 0;

  return (
    <section aria-labelledby={`list-${direction}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id={`list-${direction}`} className="flex items-center gap-2 text-lg font-bold">
          <span className={`grid size-6 place-items-center rounded-md text-white ${pay ? "bg-pay" : "bg-receive"}`}>
            {pay ? <ArrowOut width={14} height={14} /> : <ArrowIn width={14} height={14} />}
          </span>
          {pay ? "To pay" : "To receive"}
        </h2>
        <Link
          href={`/transactions?direction=${direction}`}
          className="group inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink"
        >
          View all
          <ArrowRight width={13} height={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          illustration={<AllClearIllustration tone={pay ? "pay" : "receive"} />}
          title={empty}
          hint={beyond > 0 ? `${plural(beyond, "item")} due after ${formatDate(horizon, today)}.` : emptyHint}
          action={
            <Link
              href={`/transactions/new?direction=${direction}`}
              className="press group inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold hover:border-ink-3"
            >
              <Plus width={14} height={14} className="transition-transform duration-200 group-hover:rotate-90" />
              {pay ? "Add a payment" : "Add money to receive"}
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <h3 className={`mb-2 text-xs font-semibold ${g.danger ? "text-overdue" : "text-ink-3"}`}>
                {g.label} <span className="font-normal">({g.items.length})</span>
              </h3>
              <ul className="space-y-2">
                {g.items.map((t) => (
                  <TransactionItem key={t.id} tx={t} today={today} variant="dashboard" index={index++} />
                ))}
              </ul>
            </div>
          ))}
          {beyond > 0 && (
            <p className="text-sm text-ink-3">
              + {plural(beyond, "more")} due after {formatDate(horizon, today)}.{" "}
              <Link href={`/transactions?direction=${direction}&status=PENDING`} className="font-medium text-ink-2 underline">
                See them
              </Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
