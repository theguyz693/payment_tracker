import Link from "next/link";
import { CashFlowChart, ContributionsChart, Donut, MonthlyBars, NetFlowChart, TrendLine } from "@/components/charts";
import { PeriodSelector } from "@/components/PeriodSelector";
import { Card, CardTitle, EmptyBlock, Metric, Note, PageHeader, Pill, Table } from "@/components/ui";
import { PieChart } from "@/components/icons";
import {
  cashFlowByMonth,
  cashFlowTotals,
  cashTrend,
  categoryTrend,
  earliestActivity,
  largestExpenses,
  previousPeriod,
  recurringCommitments,
  recurringNext12Months,
  spendingByCategory,
} from "@/lib/analytics";
import { formatDate, monthBounds, monthKey, shiftMonth } from "@/lib/dates";
import { formatPct, formatSignedPct } from "@/lib/decimal";
import { formatINR, formatSignedINR } from "@/lib/money";
import { monthsInRange, resolvePeriod } from "@/lib/period";
import { ASSET_LABEL, contributionsByMonth } from "@/lib/portfolio";
import { FREQUENCY_LABEL } from "@/lib/types";
import { loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const ASSET_COLORS: Record<string, string> = { MF: "#6d4bd8", STOCK: "#3a4bd1", ETF: "#0b6fa4", GOLD: "#a26a08", OTHER: "#64748b" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const today = await getToday();
  const period = resolvePeriod(await searchParams, today);
  const fp = await loadFinancialPicture(user.id, today);
  const { transactions, settlements, portfolio, settings } = fp;
  const flows = portfolio.flows;
  const earliest = earliestActivity(settlements, flows);

  if (!earliest && transactions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" />
        <EmptyBlock icon={<PieChart width={20} height={20} />} title="Nothing to analyse yet" hint="Once you mark payments as paid or received, trends and breakdowns appear here." />
      </div>
    );
  }

  const cur = cashFlowTotals(settlements, flows, period.start, period.end);
  const prevRange = previousPeriod(period.start, period.end);
  const prev = cashFlowTotals(settlements, flows, prevRange.start, prevRange.end);

  // Charts cover the period (at least 6 months), but never start before the first real activity.
  let chartStart = monthsInRange(period.start, period.end).length >= 6 ? period.start : `${shiftMonth(monthKey(period.end), -5)}-01`;
  if (earliest && chartStart < `${monthKey(earliest)}-01`) chartStart = `${monthKey(earliest)}-01`;
  const chartEnd = period.end < today ? period.end : monthBounds(monthKey(today)).end;
  const monthly = earliest ? cashFlowByMonth(settlements, flows, chartStart, chartEnd) : [];

  const categories = spendingByCategory(settlements, period.start, period.end);
  const trend = categoryTrend(settlements, chartStart, chartEnd);
  const biggest = largestExpenses(settlements, period.start, period.end, 6);
  const commitments = recurringCommitments(transactions);
  const next12 = recurringNext12Months(transactions, today);
  const contributions = contributionsByMonth(portfolio.holdings.flatMap((h) => h.txns));
  const cashPoints = settings.cashBalancePaise !== null && settings.cashAsOf ? cashTrend(settings.cashBalancePaise, settings.cashAsOf, settlements, flows, today) : null;

  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const ytd = cashFlowTotals(settlements, flows, `${year}-01-01`, today);
  const lastYtd = cashFlowTotals(settlements, flows, `${lastYear}-01-01`, `${lastYear}${today.slice(4)}`);
  const savingsRate = cur.incoming.totalPaise > 0 ? cur.netPaise / cur.incoming.totalPaise : null;
  const range = `from=${period.start}&to=${period.end}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="How your money has moved. Everything here is from payments you've actually recorded, except where marked as scheduled."
        actions={<PeriodSelector period={period} basePath="/analytics" />}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric index={0} label="Money in" value={formatINR(cur.incoming.totalPaise)} tone="in" sub={<Change cur={cur.incoming.totalPaise} prev={prev.incoming.totalPaise} />} href={`/transactions/history?type=RECEIPT&${range}`} />
        <Metric index={1} label="Spending" value={formatINR(cur.outgoing.totalPaise)} tone="out" sub={<Change cur={cur.outgoing.totalPaise} prev={prev.outgoing.totalPaise} invert />} href={`/transactions/history?type=PAYMENT&${range}`} />
        <Metric index={2} label="Net cash flow" value={formatSignedINR(cur.netPaise)} tone={cur.netPaise >= 0 ? "gain" : "loss"} sub={`Previous: ${formatSignedINR(prev.netPaise)}`} info="Money in − spending − net invested. Compared with the same-length period just before." />
        <Metric
          index={3}
          label="Kept"
          value={savingsRate === null ? "—" : formatPct(savingsRate, 0)}
          tone={savingsRate !== null && savingsRate >= 0 ? "gain" : "loss"}
          sub="of money in, after spending and investing"
          info="Net cash flow as a share of money in. Negative means you spent or invested more than came in."
        />
      </section>

      <Card>
        <CardTitle hint={`${formatDate(chartStart, today)} – ${formatDate(chartEnd < today ? chartEnd : today, today)} · starts at your first recorded activity`}>Income vs expenses</CardTitle>
        {monthly.length ? <CashFlowChart data={monthly} height={300} /> : <EmptyBlock title="No recorded activity yet" />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Positive months kept money; negative months drew on savings.">Monthly net cash flow</CardTitle>
          {monthly.length ? <NetFlowChart data={monthly} /> : <EmptyBlock title="No data" />}
        </Card>
        <Card>
          <CardTitle hint={period.label}>Spending by category</CardTitle>
          {categories.length ? (
            <Donut label="Spending by category" data={categories.slice(0, 8).map((c) => ({ name: c.name, valuePaise: c.totalPaise }))} centerLabel="Total" centerValue={formatINR(cur.outgoing.totalPaise)} />
          ) : (
            <EmptyBlock title="No spending in this period" />
          )}
        </Card>
      </div>

      {trend.categories.length > 0 && (
        <Card>
          <CardTitle hint="Top categories month by month. Click a category to see the payments.">Category trends</CardTitle>
          <Table>
            <thead>
              <tr>
                <th>Month</th>
                {trend.categories.map((c) => (
                  <th key={c.id} className="text-right">
                    <Link href={`/transactions/history?type=PAYMENT&group=${encodeURIComponent(c.id)}&from=${chartStart}&to=${chartEnd}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </th>
                ))}
                <th className="text-right">Everything else</th>
              </tr>
            </thead>
            <tbody>
              {trend.rows.map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap text-ink-2">{r.month}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className="num text-right">
                      {v ? formatINR(v) : <span className="text-ink-3">—</span>}
                    </td>
                  ))}
                  <td className="num text-right text-ink-2">{r.otherPaise ? formatINR(r.otherPaise) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle hint={period.label}>Largest expenses</CardTitle>
          {biggest.length ? (
            <ul className="divide-y divide-line">
              {biggest.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/transactions/${s.transactionId}/edit`} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="text-xs text-ink-3">
                      {s.categoryName} · {formatDate(s.settledOn, today)}
                    </span>
                  </Link>
                  <span className="num font-semibold">{formatINR(s.amountPaise)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBlock title="No payments in this period" />
          )}
        </Card>
        <Card>
          <CardTitle hint="Totals for the calendar year so far, compared with the same dates last year.">Year to date</CardTitle>
          <Table>
            <thead>
              <tr>
                <th />
                <th className="text-right">{year}</th>
                <th className="text-right">{lastYear}</th>
              </tr>
            </thead>
            <tbody>
              <YearRow label="Money in" a={ytd.incoming.totalPaise} b={lastYtd.incoming.totalPaise} />
              <YearRow label="Spending" a={ytd.outgoing.totalPaise} b={lastYtd.outgoing.totalPaise} />
              <YearRow label="Invested (net)" a={ytd.investedPaise - ytd.divestedPaise} b={lastYtd.investedPaise - lastYtd.divestedPaise} />
              <YearRow label="Net cash flow" a={ytd.netPaise} b={lastYtd.netPaise} signed />
            </tbody>
          </Table>
          {earliest && earliest > `${lastYear}-01-01` && <p className="mt-2 text-xs text-ink-3">Records start {formatDate(earliest, today)}, so earlier figures may be incomplete.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Scheduled, not yet paid. Recurring payments only.">Recurring commitments · next 12 months</CardTitle>
          <MonthlyBars data={next12} name="Scheduled" tone="out" />
        </Card>
        <Card>
          <CardTitle hint={`${formatINR(commitments.monthlyPaise)}/month · ${formatINR(commitments.annualPaise)}/year`}>Biggest commitments</CardTitle>
          {commitments.items.length ? (
            <ul className="divide-y divide-line">
              {commitments.items.slice(0, 7).map((c) => (
                <li key={c.transaction.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/transactions/${c.transaction.id}/edit`} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium">{c.transaction.title}</span>
                    <span className="text-xs text-ink-3">
                      {formatINR(c.transaction.amountPaise)} · {FREQUENCY_LABEL[c.transaction.frequency]}
                    </span>
                  </Link>
                  <span className="num text-right font-semibold">
                    {formatINR(c.monthlyPaise)}
                    <span className="block text-xs font-normal text-ink-3">/month</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBlock title="No recurring payments" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Recorded purchases and sales. Scheduled SIPs aren't included until recorded.">Investment contributions</CardTitle>
          {contributions.length ? <ContributionsChart data={contributions} /> : <EmptyBlock title="No investments recorded" hint="Add holdings under Investments." />}
        </Card>
        <Card>
          <CardTitle hint={portfolio.totals.unvaluedCount ? `${portfolio.totals.unvaluedCount} holding(s) have no price and are left out` : "By current estimated value"}>Investment allocation</CardTitle>
          {portfolio.totals.allocation.length ? (
            <Donut
              label="Investment allocation"
              data={portfolio.totals.allocation.map((a) => ({ name: ASSET_LABEL[a.type], valuePaise: a.valuePaise, color: ASSET_COLORS[a.type] }))}
              centerLabel="Value"
              centerValue={formatINR(portfolio.totals.valuePaise)}
            />
          ) : (
            <EmptyBlock title="No valued holdings" />
          )}
        </Card>
      </div>

      <Card>
        <CardTitle hint="Month-end estimates from the balance you entered in Settings, moved by recorded payments and investments.">Cash balance trend</CardTitle>
        {cashPoints && cashPoints.length > 1 ? (
          <>
            <TrendLine data={cashPoints} name="Estimated cash" tone="in" />
            <div className="mt-2">
              <Note>Starts on {formatDate(settings.cashAsOf!, today)}, the date of the balance you entered. Earlier balances aren&apos;t known, so they aren&apos;t shown.</Note>
            </div>
          </>
        ) : (
          <EmptyBlock
            title={cashPoints ? "Not enough history yet" : "Add a starting balance to see this"}
            hint={cashPoints ? "The trend appears after your first month-end since the balance date." : "Enter your cash balance in Settings. Balances before that date can't be reconstructed accurately."}
            action={
              !cashPoints && (
                <Link href="/settings" className="text-sm font-semibold underline">
                  Go to Settings
                </Link>
              )
            }
          />
        )}
      </Card>
    </div>
  );
}

function Change({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (prev === 0) return <span>No data for the previous period</span>;
  const ratio = (cur - prev) / prev;
  const good = invert ? ratio <= 0 : ratio >= 0;
  return (
    <span>
      <Pill tone={good ? "gain" : "loss"}>{formatSignedPct(ratio, 0)}</Pill> vs previous period
    </span>
  );
}

function YearRow({ label, a, b, signed = false }: { label: string; a: number; b: number; signed?: boolean }) {
  const f = signed ? formatSignedINR : formatINR;
  return (
    <tr>
      <td className="text-ink-2">{label}</td>
      <td className="num text-right font-semibold">{f(a)}</td>
      <td className="num text-right text-ink-2">{f(b)}</td>
    </tr>
  );
}
