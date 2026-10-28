import Link from "next/link";
import { ContributionsChart, Donut } from "@/components/charts";
import { Card, CardTitle, EmptyBlock, Metric, Note, PageHeader, Pill, Table, btnPrimary } from "@/components/ui";
import { Plus, TrendingUp } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatPct, formatScaled, formatSignedPct, QTY_DP } from "@/lib/decimal";
import { formatINR, formatSignedINR } from "@/lib/money";
import { ASSET_LABEL, ASSET_TYPES, contributionsByMonth, xirrMeaningful } from "@/lib/portfolio";
import { loadPortfolio, type HoldingView } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investments" };

const ASSET_COLORS: Record<string, string> = { MF: "#6d4bd8", STOCK: "#3a4bd1", ETF: "#0b6fa4", GOLD: "#a26a08", OTHER: "#64748b" };

export default async function InvestmentsPage() {
  const user = await requireUser();
  const today = await getToday();
  const { holdings, totals } = await loadPortfolio(user.id, today);
  const allFlows = holdings.flatMap((h) => h.stats.flows);
  const showXirr = totals.xirr !== null && xirrMeaningful(allFlows, today);
  const upcomingSips = holdings
    .filter((h) => h.nextSip && h.holding.sip)
    .map((h) => ({ id: h.holding.id, name: h.holding.name, date: h.nextSip!, amountPaise: h.holding.sip!.amountPaise }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const contributions = contributionsByMonth(holdings.flatMap((h) => h.txns));
  const totalGain = totals.unrealisedPaise + totals.realisedPaise + totals.dividendsPaise;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Investments"
        description="Mutual funds and SIPs, stocks, ETFs and gold. This tracks what you hold; it doesn't recommend buying or selling."
        actions={
          <Link href="/investments/new" className={btnPrimary}>
            <Plus width={15} height={15} /> Add investment
          </Link>
        }
      />

      {holdings.length === 0 ? (
        <EmptyBlock
          icon={<TrendingUp width={20} height={20} />}
          title="No investments yet"
          hint="Add a mutual fund or SIP, a stock or ETF, or gold. Then record what you've bought to see value and returns."
          action={
            <Link href="/investments/new" className={btnPrimary}>
              <Plus width={15} height={15} /> Add your first investment
            </Link>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric index={0} label="Current value (est.)" value={formatINR(totals.valuePaise)} emphasis sub={totals.unvaluedCount ? `${totals.unvaluedCount} holding(s) unpriced, not included` : "From latest available prices"} />
            <Metric
              index={1}
              label="Cash put in"
              value={formatINR(totals.contributedPaise)}
              sub={totals.proceedsPaise ? `${formatINR(totals.proceedsPaise)} taken out from sales` : "Recorded purchases incl. fees"}
              info="Every recorded purchase, including fees. Scheduled SIPs aren't counted until you record them."
            />
            <Metric
              index={2}
              label="Total gain"
              value={totals.unvaluedCount ? "—" : formatSignedINR(totalGain)}
              tone={totalGain >= 0 ? "gain" : "loss"}
              sub={`Unrealised ${formatSignedINR(totals.unrealisedPaise)} · Realised ${formatSignedINR(totals.realisedPaise)}`}
              info="Unrealised = value of what you hold − its cost. Realised = profit or loss on units already sold (FIFO). Dividends/payouts are added."
            />
            <Metric
              index={3}
              label={showXirr ? "XIRR (annualised)" : "Absolute return"}
              value={showXirr ? formatSignedPct(totals.xirr!) : totals.absoluteReturn === null ? "—" : formatSignedPct(totals.absoluteReturn)}
              tone={(showXirr ? totals.xirr! : (totals.absoluteReturn ?? 0)) >= 0 ? "gain" : "loss"}
              sub={showXirr ? `Absolute ${totals.absoluteReturn === null ? "—" : formatSignedPct(totals.absoluteReturn)}` : "Not annualised"}
              info="Absolute return = total gain ÷ cash put in. XIRR is a money-weighted annual rate that accounts for when each rupee went in; it's shown once your first investment is at least a year old, because annualising a few months is misleading."
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardTitle hint="By current estimated value">Allocation</CardTitle>
              {totals.allocation.length ? (
                <Donut
                  label="Allocation by asset type"
                  data={totals.allocation.map((a) => ({ name: ASSET_LABEL[a.type], valuePaise: a.valuePaise, color: ASSET_COLORS[a.type] }))}
                  centerLabel="Value"
                  centerValue={formatINR(totals.valuePaise)}
                />
              ) : (
                <EmptyBlock title="No priced holdings yet" hint="Record purchases with quantities, and a price (live or manual)." />
              )}
            </Card>
            <Card>
              <CardTitle hint="Recorded only">Contributions over time</CardTitle>
              {contributions.length ? <ContributionsChart data={contributions} /> : <EmptyBlock title="Nothing recorded yet" />}
            </Card>
          </div>

          {upcomingSips.length > 0 && (
            <Card>
              <CardTitle hint="Scheduled, not yet recorded">Upcoming SIPs</CardTitle>
              <ul className="divide-y divide-line">
                {upcomingSips.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/investments/${s.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {s.name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-ink-3">{formatDate(s.date, today)}</span>
                      <span className="num font-semibold text-invest">{formatINR(s.amountPaise)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {ASSET_TYPES.filter((t) => holdings.some((h) => h.holding.type === t)).map((t) => (
            <section key={t}>
              <h2 className="mb-2 text-sm font-semibold text-ink-2">{ASSET_LABEL[t]}s</h2>
              <Table>
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Invested</th>
                    <th className="text-right">Value</th>
                    <th className="text-right">Gain</th>
                    <th className="hidden text-right md:table-cell">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings
                    .filter((h) => h.holding.type === t)
                    .map((h) => (
                      <HoldingRow key={h.holding.id} h={h} today={today} />
                    ))}
                </tbody>
              </Table>
            </section>
          ))}

          <Note>
            Values are estimates from the latest available price. Mutual fund NAVs are published once a day by AMFI; stock quotes (when configured) are delayed; gold uses the price you enter, adjusted for purity and your expected sell deduction. This page tracks; it does not give investment advice.
          </Note>
        </>
      )}
    </div>
  );
}

function HoldingRow({ h, today }: { h: HoldingView; today: string }) {
  const s = h.stats;
  const gain = s.unrealisedPaise;
  return (
    <tr>
      <td>
        <Link href={`/investments/${h.holding.id}`} className="font-medium hover:underline">
          {h.holding.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          {h.holding.symbol ?? (h.holding.providerKey ? `AMFI ${h.holding.providerKey}` : null)}
          {h.holding.sip && <Pill tone={h.holding.sip.status === "ACTIVE" ? "invest" : "neutral"}>SIP {h.holding.sip.status.toLowerCase()}</Pill>}
          {h.error && <Pill tone="overdue">Check history</Pill>}
        </div>
      </td>
      <td className="num text-right">{s.qtyMicro === null ? <span className="text-ink-3">—</span> : formatScaled(s.qtyMicro, QTY_DP, 0)}</td>
      <td className="num text-right">{formatINR(s.costBasisPaise)}</td>
      <td className="num text-right font-semibold">{s.valuePaise === null ? <span className="text-xs font-normal text-pending">No price</span> : formatINR(s.valuePaise)}</td>
      <td className={`num text-right ${gain === null ? "" : gain >= 0 ? "text-gain" : "text-loss"}`}>
        {gain === null ? "—" : formatSignedINR(gain)}
        {gain !== null && s.costBasisPaise > 0 && <div className="text-xs">{formatPct(gain / s.costBasisPaise, 1)}</div>}
      </td>
      <td className="hidden text-right text-xs md:table-cell">
        {h.price ? (
          <>
            <div className="num">₹{formatScaled(h.price.price4, 4, 2)}</div>
            <div className={h.price.stale ? "text-pending" : "text-ink-3"}>
              {h.price.manual ? "Manual" : h.price.source.split(" ")[0]} · {formatDate(h.price.asOf, today)}
              {h.price.stale && " · stale"}
            </div>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
    </tr>
  );
}
