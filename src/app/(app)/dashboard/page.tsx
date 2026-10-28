import Link from "next/link";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CashFlowChart, Donut } from "@/components/charts";
import { AllClearIllustration } from "@/components/Illustrations";
import { LastUpdated } from "@/components/LastUpdated";
import { PeriodSelector } from "@/components/PeriodSelector";
import { plural } from "@/components/StatCard";
import { EmptyState, TransactionItem } from "@/components/TransactionItem";
import { Card, CardTitle, EmptyBlock, Metric, Money, Note, PageHeader, Pill, ProgressBar, btnSecondary } from "@/components/ui";
import { ArrowIn, ArrowOut, ArrowRight, Landmark, Plus, Target, TrendingUp, Wallet } from "@/components/icons";
import {
  cashFlowByMonth,
  cashFlowTotals,
  earliestActivity,
  obligations,
  plannedExpenses,
  recurringCommitments,
  spendingByCategory,
} from "@/lib/analytics";
import { addDays, formatDate, monthBounds, monthKey, shiftMonth } from "@/lib/dates";
import { formatSignedPct } from "@/lib/decimal";
import { buildEvents, EVENT_LABEL } from "@/lib/forecast";
import { formatINR } from "@/lib/money";
import { monthsInRange, resolvePeriod } from "@/lib/period";
import { openItems } from "@/lib/summary";
import type { Direction, ISODate, Transaction } from "@/lib/types";
import { loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const today = await getToday();
  const period = resolvePeriod(await searchParams, today);
  const fp = await loadFinancialPicture(user.id, today);
  const { transactions, settlements, goals, loans, portfolio, cash } = fp;
  const firstName = user.name.split(" ")[0];
  const isNew = transactions.length === 0 && goals.length === 0 && portfolio.holdings.length === 0 && loans.length === 0;

  const o = obligations(transactions, today);
  const flow = cashFlowTotals(settlements, portfolio.flows, period.start, period.end);
  const planned = [30, 90, 365].map((d) => ({ days: d, ...plannedExpenses(transactions, today, d) }));
  const commitments = recurringCommitments(transactions);
  const categories = spendingByCategory(settlements, period.start, period.end);

  // Chart: the selected period, widened to 6 months when it's shorter, never before the first real activity.
  const earliest = earliestActivity(settlements, portfolio.flows);
  let chartStart = monthsInRange(period.start, period.end).length >= 3 ? period.start : `${shiftMonth(monthKey(period.end), -5)}-01`;
  if (earliest && chartStart < `${monthKey(earliest)}-01`) chartStart = `${monthKey(earliest)}-01`;
  const chartEnd = period.end < today ? period.end : monthBounds(monthKey(today)).end;
  const chart = earliest ? cashFlowByMonth(settlements, portfolio.flows, chartStart, chartEnd) : [];

  const upcoming = buildEvents({
    transactions,
    sips: fp.sipSources,
    goals: fp.goalSources,
    from: today,
    to: addDays(today, 13),
    today,
  }).slice(0, 8);

  const loanOutstanding = loans.reduce((a, l) => a + l.status.outstandingPaise, 0);
  const netWorth = cash ? cash.paise + portfolio.totals.valuePaise - loanOutstanding : null;
  const goalSaved = goals.reduce((a, g) => a + g.savedPaise, 0);
  const range = `from=${period.start}&to=${period.end}`;

  if (isNew) return <Welcome firstName={firstName} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`Today is ${formatDate(today)}. Outstanding amounts are as of today; cash flow covers ${period.label.toLowerCase()}.`}
        actions={<LastUpdated at={new Date().toISOString()} />}
      />

      {/* Outstanding: what I owe vs what I'm owed */}
      <section aria-label="Outstanding" className="grid overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
        <HeroPanel direction="PAY" total={o.owedByMe.totalPaise} count={o.owedByMe.count} overdue={o.overduePay.totalPaise} />
        <HeroPanel direction="RECEIVE" total={o.owedToMe.totalPaise} count={o.owedToMe.count} overdue={o.overdueReceive.totalPaise} />
      </section>

      <section aria-label="Due soon" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          index={0}
          label="Due this week"
          value={formatINR(o.weekPay.totalPaise)}
          sub={o.weekPay.count ? plural(o.weekPay.count, "payment") : "Nothing in the next 7 days"}
          tone="out"
          href={`/calendar?view=agenda`}
          info="Scheduled payments from today through the next 6 days, including repeats of recurring items. Overdue items are counted separately."
        />
        <Metric
          index={1}
          label="Expected this week"
          value={formatINR(o.weekReceive.totalPaise)}
          sub={o.weekReceive.count ? plural(o.weekReceive.count, "item") : "Nothing expected"}
          tone="in"
          href={`/calendar?view=agenda`}
          info="Money owed to you that is due in the next 7 days. It isn't counted as received until you mark it received."
        />
        <Metric
          index={2}
          label="Rest of this month"
          value={formatINR(o.monthPay.totalPaise)}
          sub={`${formatINR(o.monthReceive.totalPaise)} expected in`}
          href={`/calendar`}
          info="Scheduled payments from today to the end of the month (excluding overdue). The sub-line shows money expected in over the same days."
        />
        <Metric
          index={3}
          label="Overdue"
          value={formatINR(o.overduePay.totalPaise)}
          sub={o.overdueReceive.count ? `${formatINR(o.overdueReceive.totalPaise)} owed to you is late` : o.overduePay.count ? plural(o.overduePay.count, "payment") : "Nothing overdue"}
          tone={o.overduePay.count || o.overdueReceive.count ? "overdue" : "neutral"}
          href="/transactions?status=OVERDUE"
        />
      </section>

      {/* Cash flow for the selected period */}
      <section aria-labelledby="cashflow" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="cashflow" className="text-lg font-bold tracking-tight">
            Cash flow · {period.label}
          </h2>
          <PeriodSelector period={period} basePath="/dashboard" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            index={0}
            label="Money in"
            value={formatINR(flow.incoming.totalPaise)}
            sub={plural(flow.incoming.count, "receipt")}
            tone="in"
            href={`/transactions/history?type=RECEIPT&${range}`}
            info="Money you marked as received in this period. Money owed to you that hasn't arrived isn't included."
          />
          <Metric
            index={1}
            label="Spending"
            value={formatINR(flow.outgoing.totalPaise)}
            sub={plural(flow.outgoing.count, "payment")}
            tone="out"
            href={`/transactions/history?type=PAYMENT&${range}`}
            info="Payments you marked as paid in this period. Investments and money set aside for goals are not spending."
          />
          <Metric
            index={2}
            label="Invested (net)"
            value={formatINR(flow.investedPaise - flow.divestedPaise)}
            sub={flow.divestedPaise ? `${formatINR(flow.investedPaise)} in · ${formatINR(flow.divestedPaise)} out` : "Recorded buys"}
            tone="invest"
            href={`/transactions/history?type=INVEST&${range}`}
            info="Recorded investment purchases minus sale proceeds and dividends. Scheduled SIPs only count once you record them."
          />
          <Metric
            index={3}
            label="Net cash flow"
            value={<AnimatedNumber paise={flow.netPaise} signed />}
            sub="In − spending − net invested"
            tone={flow.netPaise >= 0 ? "gain" : "loss"}
            info="Money in, minus spending, minus net money moved into investments, for this period."
          />
        </div>
        <Card>
          <CardTitle hint={earliest ? `Actual cash flow by month, starting from your first recorded activity.` : undefined}>Income vs expenses</CardTitle>
          {chart.length ? (
            <CashFlowChart data={chart} />
          ) : (
            <EmptyBlock title="No payments recorded yet" hint="Mark items as paid or received and your cash flow will appear here." />
          )}
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
        {/* Spending breakdown */}
        <Card>
          <CardTitle hint={period.label} action={<SeeAll href={`/analytics?period=${period.key === "custom" ? `custom&${range}` : period.key}`} label="Analytics" />}>
            Spending by category
          </CardTitle>
          {categories.length ? (
            <Donut
              label="Spending by category"
              data={categories.slice(0, 8).map((c) => ({ name: c.name, valuePaise: c.totalPaise }))}
              centerLabel="Spent"
              centerValue={formatINR(flow.outgoing.totalPaise)}
            />
          ) : (
            <EmptyBlock title="No spending in this period" />
          )}
        </Card>

        {/* Upcoming obligations */}
        <Card>
          <CardTitle hint="Next 14 days, scheduled (not yet paid)" action={<SeeAll href="/calendar" label="Calendar" />}>
            Coming up
          </CardTitle>
          {upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={e.href} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="text-xs text-ink-3">
                      {formatDate(e.date, today)} · {EVENT_LABEL[e.kind]}
                      {e.overdue && <span className="font-semibold text-overdue"> · overdue</span>}
                    </span>
                  </Link>
                  <span className={`num shrink-0 font-semibold ${e.flow === "in" ? "text-receive-strong" : e.flow === "save" ? "text-save" : ""}`}>
                    {e.flow === "in" ? "+" : ""}
                    {formatINR(e.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBlock title="Nothing scheduled in the next two weeks" />
          )}
        </Card>
      </div>

      {/* Planning & wealth */}
      <section aria-label="Planning" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card index={0}>
          <CardTitle info="Scheduled outgoing payments from today, including every repeat of recurring items. Overdue items aren't included.">Planned spending</CardTitle>
          <dl className="space-y-2 text-sm">
            {planned.map((p) => (
              <div key={p.days} className="flex items-center justify-between">
                <dt className="text-ink-2">Next {p.days} days</dt>
                <dd className="num font-semibold">{formatINR(p.totalPaise)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card index={1}>
          <CardTitle
            info="Active recurring payments converted to a monthly figure (e.g. a yearly ₹1,200 counts as ₹100/month). Paused items are excluded."
            action={<SeeAll href="/transactions?view=recurring" label="Manage" />}
          >
            Recurring commitments
          </CardTitle>
          <div className="num text-2xl font-bold">
            {formatINR(commitments.monthlyPaise)}
            <span className="text-sm font-medium text-ink-3"> /month</span>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {formatINR(commitments.annualPaise)} a year · {plural(commitments.items.length, "item")}
            {commitments.pausedCount > 0 && ` · ${commitments.pausedCount} paused`}
          </p>
        </Card>
        <Card index={2}>
          <CardTitle action={<SeeAll href="/goals" label="Goals" />}>Savings goals</CardTitle>
          {goals.length ? (
            <>
              <div className="num text-2xl font-bold text-save">{formatINR(goalSaved)}</div>
              <p className="mt-1 mb-3 text-xs text-ink-3">set aside across {plural(goals.length, "goal")}</p>
              <ul className="space-y-2.5">
                {goals.slice(0, 3).map((g) => (
                  <li key={g.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <Link href={`/goals/${g.id}`} className="truncate font-medium hover:underline">
                        {g.name}
                      </Link>
                      <span className="text-ink-3">{Math.round(g.progress * 100)}%</span>
                    </div>
                    <ProgressBar value={g.progress} tone={g.status === "BEHIND" || g.status === "OVERDUE" ? "pending" : "save"} label={`${g.name} progress`} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <QuickStart href="/goals/new" icon={<Target width={18} height={18} />} text="Plan for a laptop, fees or an emergency fund." />
          )}
        </Card>
        <Card index={3}>
          <CardTitle action={<SeeAll href="/investments" label="Portfolio" />}>Investments</CardTitle>
          {portfolio.holdings.length ? (
            <>
              <div className="num text-2xl font-bold">{formatINR(portfolio.totals.valuePaise)}</div>
              <p className="mt-1 text-xs text-ink-3">
                estimated value · {formatINR(portfolio.totals.contributedPaise)} invested
              </p>
              {portfolio.totals.absoluteReturn !== null && (
                <p className="mt-2">
                  <Pill tone={portfolio.totals.absoluteReturn >= 0 ? "gain" : "loss"}>{formatSignedPct(portfolio.totals.absoluteReturn)} absolute</Pill>
                </p>
              )}
              {portfolio.totals.unvaluedCount > 0 && <p className="mt-2 text-xs text-pending">{plural(portfolio.totals.unvaluedCount, "holding")} without a price</p>}
            </>
          ) : (
            <QuickStart href="/investments/new" icon={<TrendingUp width={18} height={18} />} text="Track SIPs, stocks and gold alongside your bills." />
          )}
        </Card>
      </section>

      {/* Net worth (only with a starting balance) */}
      <Card>
        <CardTitle
          info="Net worth = estimated cash + investments (valued holdings) − outstanding loan principal. Money owed to you is not included."
          action={<SeeAll href="/settings" label={cash ? "Update balance" : "Add balance"} />}
        >
          Net worth
        </CardTitle>
        {cash && netWorth !== null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Cash (estimated)" value={<Money paise={cash.paise} />} sub={`From your balance on ${formatDate(cash.asOf, today)}`} />
            <Figure label="Investments" value={<Money paise={portfolio.totals.valuePaise} />} sub={portfolio.totals.unvaluedCount ? "Some holdings unpriced" : "Current estimate"} />
            <Figure label="Loans outstanding" value={<Money paise={-loanOutstanding} />} sub={loans.length ? plural(loans.length, "loan") : "None tracked"} />
            <Figure label="Net worth" value={<Money paise={netWorth} />} sub="Excludes money owed to you" strong />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-ink-2">
              Net worth needs a starting point. Enter how much cash you have today (all accounts combined) and the app will keep it up to date from the payments you record.
            </p>
            <Link href="/settings" className={btnSecondary}>
              <Wallet width={15} height={15} /> Set cash balance
            </Link>
          </div>
        )}
        {o.owedToMe.totalPaise > 0 && cash && (
          <div className="mt-3">
            <Note>{formatINR(o.owedToMe.totalPaise)} owed to you isn&apos;t counted until it arrives.</Note>
          </div>
        )}
      </Card>

      {/* Due lists with quick settle */}
      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <DueList direction="PAY" items={openItems(transactions, "PAY").filter((t) => !t.paused)} today={today} empty="No payments due 🎉" emptyHint="Add rent, EMIs or bills to see them here." />
        <DueList
          direction="RECEIVE"
          items={openItems(transactions, "RECEIVE").filter((t) => !t.paused)}
          today={today}
          empty="No pending money to receive."
          emptyHint="Track rent from tenants, salary or money someone owes you."
        />
      </div>
    </div>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
      {label}
      <ArrowRight width={12} height={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

function Figure({ label, value, sub, strong = false }: { label: string; value: React.ReactNode; sub?: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className={`mt-1 font-bold ${strong ? "text-2xl" : "text-xl"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function QuickStart({ href, icon, text }: { href: string; icon: React.ReactNode; text: string }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-dashed border-line-strong p-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas">{icon}</span>
      <span>
        {text}
        <span className="mt-1 flex items-center gap-1 font-semibold text-ink">
          Get started <ArrowRight width={12} height={12} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}

function Welcome({ firstName }: { firstName: string }) {
  const steps = [
    { href: "/transactions/new", icon: <ArrowOut width={18} height={18} />, title: "Add a payment or money you're owed", text: "Rent, EMIs, bills, salary, money a friend owes you." },
    { href: "/goals/new", icon: <Target width={18} height={18} />, title: "Set a savings goal", text: "A laptop, semester fees, an emergency fund." },
    { href: "/loans", icon: <Landmark width={18} height={18} />, title: "Understand a loan", text: "EMI calculator, amortisation and prepayment scenarios." },
    { href: "/investments/new", icon: <TrendingUp width={18} height={18} />, title: "Track investments", text: "Mutual funds and SIPs, stocks, ETFs and gold." },
    { href: "/settings", icon: <Wallet width={18} height={18} />, title: "Enter your cash balance", text: "Unlocks net worth and the projected balance forecast." },
  ];
  return (
    <div className="space-y-8">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description="This is your financial command centre. Start with whichever matters most; everything here connects up as you add more."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <Link
            key={s.href}
            href={s.href}
            className="rise group flex gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-line-strong hover:shadow-[0_6px_20px_-12px_rgb(20_28_43/0.35)]"
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas text-ink-2 group-hover:text-ink">{s.icon}</span>
            <span>
              <span className="block font-semibold">{s.title}</span>
              <span className="mt-0.5 block text-sm text-ink-3">{s.text}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link href="/transactions/new" className="press inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:opacity-90">
        <Plus width={15} height={15} /> Add your first payment
      </Link>
    </div>
  );
}

function HeroPanel({ direction, total, count, overdue }: { direction: Direction; total: number; count: number; overdue: number }) {
  const pay = direction === "PAY";
  return (
    <Link
      href={`/transactions?direction=${direction}&status=PENDING`}
      className={`rise block px-5 py-5 transition-[filter] hover:brightness-[0.98] sm:px-6 ${pay ? "bg-pay-soft" : "border-t border-line bg-receive-soft sm:border-t-0 sm:border-l"}`}
      style={{ "--i": pay ? 0 : 1 } as React.CSSProperties}
    >
      <div className={`flex items-center gap-1.5 text-sm font-semibold ${pay ? "text-pay-strong" : "text-receive-strong"}`}>
        {pay ? <ArrowOut /> : <ArrowIn />}
        {pay ? "You owe" : "Owed to you"}
      </div>
      <div className="num mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">
        <AnimatedNumber paise={total} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
        {count ? `${plural(count, "open item")} at their next due date` : pay ? "Nothing to pay" : "Nothing expected"}
        {overdue > 0 && <span className="inline-flex rounded-full bg-overdue px-2 py-0.5 text-xs font-semibold text-white">{formatINR(overdue)} overdue</span>}
      </div>
    </Link>
  );
}

function DueList({ direction, items, today, empty, emptyHint }: { direction: Direction; items: Transaction[]; today: ISODate; empty: string; emptyHint: string }) {
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
        <SeeAll href={`/transactions?direction=${direction}`} label="View all" />
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

