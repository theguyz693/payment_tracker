import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { TrendLine } from "@/components/charts";
import { InvTxnForm, ManualPriceForm } from "@/components/InvestmentForms";
import { Card, CardTitle, Metric, Note, PageHeader, Pill, Table, btnGhost, btnSecondary } from "@/components/ui";
import { Pause, Pencil, Play, Trash } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatPct, formatScaled, formatSignedPct, PRICE_DP, QTY_DP } from "@/lib/decimal";
import { formatINR, formatSignedINR } from "@/lib/money";
import { ASSET_LABEL, xirrMeaningful } from "@/lib/portfolio";
import { FREQUENCY_LABEL } from "@/lib/types";
import { archiveHoldingAction, deleteInvTxnAction, sipStatusAction } from "@/server/invest-actions";
import { loadPortfolio } from "@/server/loaders";
import { priceHistory, priceKey } from "@/server/prices";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investment" };

export default async function HoldingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const today = await getToday();
  const { holdings } = await loadPortfolio(user.id, today);
  const view = holdings.find((h) => h.holding.id === id);
  if (!view) notFound();
  const { holding, stats: s, price, txns } = view;
  const history = holding.provider && holding.providerKey ? await priceHistory(priceKey(holding.provider, holding.providerKey)) : [];
  const unit = holding.type === "GOLD" ? "g" : holding.type === "MF" ? "units" : "shares";
  const totalGain = s.totalGainPaise;
  const showXirr = view.xirr !== null && xirrMeaningful(s.flows, today);

  const archive = async () => {
    "use server";
    return archiveHoldingAction(id);
  };
  const setSip = (status: "ACTIVE" | "PAUSED" | "STOPPED") => async () => {
    "use server";
    return sipStatusAction(id, status);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/investments" className="text-xs font-semibold text-ink-3 hover:text-ink">
            ← Investments
          </Link>
        }
        title={holding.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={holding.type === "GOLD" ? "gold" : "invest"}>{ASSET_LABEL[holding.type]}</Pill>
            {holding.symbol && <span>{holding.symbol}</span>}
            {holding.type === "MF" && holding.providerKey && <span>AMFI scheme {holding.providerKey}</span>}
            {holding.gold && (
              <span>
                {holding.gold.karat}K · {holding.gold.sellSpreadBps / 100}% expected sell deduction
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Link href={`/investments/${id}/edit`} className={btnSecondary}>
              <Pencil width={14} height={14} /> Edit
            </Link>
            <ActionButton
              run={archive}
              redirectTo="/investments"
              successMessage="Investment archived. Its transactions are kept."
              confirm={{ title: `Archive ${holding.name}?`, body: "It's removed from your portfolio totals. Transactions are kept in the database.", label: "Archive" }}
              className={btnSecondary}
            >
              <Trash width={14} height={14} /> Archive
            </ActionButton>
          </>
        }
      />

      {view.error && <Note tone="warn">{view.error} Values below ignore sales until this is fixed.</Note>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric index={0} label="Current value (est.)" value={s.valuePaise === null ? "—" : formatINR(s.valuePaise)} emphasis sub={s.qtyMicro === null ? "Add quantities to value this" : `${formatScaled(s.qtyMicro, QTY_DP, 0)} ${unit}`} />
        <Metric
          index={1}
          label="Cost of what you hold"
          value={formatINR(s.costBasisPaise)}
          sub={s.avgCost4 ? `Avg ₹${formatScaled(s.avgCost4, PRICE_DP, 2)} per ${unit.replace(/s$/, "")} incl. fees` : `${formatINR(s.contributedPaise)} put in`}
          info="FIFO cost (including fees) of the units still held."
        />
        <Metric
          index={2}
          label="Unrealised / realised"
          value={s.unrealisedPaise === null ? "—" : formatSignedINR(s.unrealisedPaise)}
          tone={(s.unrealisedPaise ?? 0) >= 0 ? "gain" : "loss"}
          sub={`Realised ${formatSignedINR(s.realisedPaise)}${s.dividendsPaise ? ` · Payouts ${formatINR(s.dividendsPaise)}` : ""}`}
        />
        <Metric
          index={3}
          label={showXirr ? "XIRR (annualised)" : "Absolute return"}
          value={showXirr ? formatSignedPct(view.xirr!) : s.absoluteReturn === null ? "—" : formatSignedPct(s.absoluteReturn)}
          tone={(showXirr ? view.xirr! : (s.absoluteReturn ?? 0)) >= 0 ? "gain" : "loss"}
          sub={totalGain === null ? "Needs a price" : `Total gain ${formatSignedINR(totalGain)}`}
          info="Absolute return isn't annualised. XIRR (money-weighted, annual) appears once the first purchase is a year old."
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card>
            <CardTitle
              hint={
                price
                  ? `₹${formatScaled(price.price4, PRICE_DP, 2)} ${holding.type === "GOLD" ? "per gram (24K)" : ""} · ${price.source} · as of ${formatDate(price.asOf, today)}`
                  : "No price yet"
              }
            >
              Price
            </CardTitle>
            {price?.stale && <Note tone="warn">This price is more than a few days old. Values may be out of date.</Note>}
            {history.length > 1 ? (
              <TrendLine data={history.map((p) => ({ date: p.date, value: p.price4 }))} valueIsPrice4 name="Price" tone={holding.type === "GOLD" ? "gold" : "invest"} />
            ) : (
              <p className="text-sm text-ink-3">
                {holding.provider
                  ? "Price history builds up from here, one point per day the price is fetched."
                  : "This holding has no live price source. Enter prices manually; the latest one is used for valuation."}
              </p>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 text-sm font-semibold">Set a price manually</div>
              <ManualPriceForm holdingId={id} today={today} label={holding.type === "GOLD" ? "24K price per gram" : holding.type === "MF" ? "NAV" : "Price"} />
              <p className="mt-2 text-xs text-ink-3">The more recent of your price and the live price is used.</p>
            </div>
          </Card>

          <Card>
            <CardTitle hint="Every recorded purchase, sale and payout">Transactions</CardTitle>
            {txns.length === 0 ? (
              <p className="text-sm text-ink-3">Nothing recorded yet. Record your first purchase on the right.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...txns].reverse().map((t) => {
                    const del = async () => {
                      "use server";
                      return deleteInvTxnAction(t.id);
                    };
                    return (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap">
                          {formatDate(t.date, today)}
                          {t.sipFor && <div className="text-xs text-invest">SIP</div>}
                        </td>
                        <td>{t.type === "BUY" ? "Buy" : t.type === "SELL" ? "Sell" : "Payout"}</td>
                        <td className="num text-right">{t.qtyMicro === null ? "—" : formatScaled(t.qtyMicro, QTY_DP, 0)}</td>
                        <td className="num text-right">{t.price4 === null ? "—" : `₹${formatScaled(t.price4, PRICE_DP, 2)}`}</td>
                        <td className="num text-right">
                          {formatINR(t.amountPaise)}
                          {t.feePaise > 0 && <div className="text-xs text-ink-3">+{formatINR(t.feePaise)} fees</div>}
                        </td>
                        <td className="text-right">
                          <ActionButton
                            run={del}
                            ariaLabel="Delete transaction"
                            className={btnGhost}
                            confirm={{ title: "Delete this transaction?", body: "Use this to fix a mistake. Totals and gains are recalculated.", label: "Delete" }}
                          >
                            <Trash width={13} height={13} />
                          </ActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {s.lots.length > 0 && (
            <Card>
              <CardTitle hint="Remaining purchase lots, oldest first. Sales use the oldest units first (FIFO).">Lots held</CardTitle>
              <Table>
                <thead>
                  <tr>
                    <th>Bought</th>
                    <th className="text-right">Qty left</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lots.map((l, i) => (
                    <tr key={i}>
                      <td>{formatDate(l.date, today)}</td>
                      <td className="num text-right">{formatScaled(l.qtyMicro, QTY_DP, 0)}</td>
                      <td className="num text-right">{formatINR(l.costPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Record a transaction</CardTitle>
            <InvTxnForm
              holdingId={id}
              type={holding.type}
              today={today}
              nextSip={view.nextSip && holding.sip ? { date: view.nextSip, amountPaise: holding.sip.amountPaise } : null}
              canSell={s.qtyMicro !== null && s.qtyMicro > 0}
            />
          </Card>
          {holding.sip && (
            <Card>
              <CardTitle
                hint={`${formatINR(holding.sip.amountPaise)} ${FREQUENCY_LABEL[holding.sip.frequency].toLowerCase()} from ${formatDate(holding.sip.anchorDate, today)}${holding.sip.endDate ? ` to ${formatDate(holding.sip.endDate, today)}` : ""}`}
              >
                SIP
              </CardTitle>
              <div className="mb-3 flex items-center gap-2 text-sm">
                <Pill tone={holding.sip.status === "ACTIVE" ? "invest" : "neutral"}>{holding.sip.status === "ACTIVE" ? "Active" : holding.sip.status === "PAUSED" ? "Paused" : "Stopped"}</Pill>
                {view.nextSip && <span className="text-ink-2">Next {formatDate(view.nextSip, today)}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {holding.sip.status !== "ACTIVE" && (
                  <ActionButton run={setSip("ACTIVE")} className={btnSecondary}>
                    <Play width={13} height={13} /> Resume
                  </ActionButton>
                )}
                {holding.sip.status === "ACTIVE" && (
                  <ActionButton run={setSip("PAUSED")} className={btnSecondary}>
                    <Pause width={13} height={13} /> Pause
                  </ActionButton>
                )}
                {holding.sip.status !== "STOPPED" && (
                  <ActionButton run={setSip("STOPPED")} className={btnSecondary} confirm={{ title: "Mark this SIP as stopped?", body: "No more instalments are scheduled. Recorded purchases are kept. You can resume later.", label: "Stop SIP", tone: "neutral" }}>
                    Stop
                  </ActionButton>
                )}
              </div>
              <p className="mt-3 text-xs text-ink-3">Scheduled instalments only count once you record them as purchases.</p>
            </Card>
          )}
          {s.costBasisPaise > 0 && s.valuePaise !== null && (
            <Card>
              <CardTitle>At a glance</CardTitle>
              <dl className="space-y-1.5 text-sm">
                <Row label="Cash put in" value={formatINR(s.contributedPaise)} />
                <Row label="Cash taken out (sales)" value={formatINR(s.proceedsPaise)} />
                <Row label="Payouts received" value={formatINR(s.dividendsPaise)} />
                <Row label="Value now (est.)" value={formatINR(s.valuePaise)} />
                <Row label="Gain on cost held" value={s.costBasisPaise ? formatPct((s.unrealisedPaise ?? 0) / s.costBasisPaise) : "—"} />
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}
