import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { LoanBalanceChart } from "@/components/charts";
import { LinkEmiForm, PrepaymentForm } from "@/components/LoanForms";
import { Card, CardTitle, Metric, Note, PageHeader, Pill, Table, btnSecondary } from "@/components/ui";
import { Pencil, Trash } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { archiveLoanAction } from "@/server/finance-actions";
import { getLoan } from "@/server/finance-repo";
import { viewLoans } from "@/server/loaders";
import { loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loan" };

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [loan, today, { transactions, settlements }] = await Promise.all([getLoan(user.id, id), getToday(), loadUserData(user.id)]);
  if (!loan) notFound();
  const [{ status, linked }] = viewLoans([loan], transactions, settlements);
  const { schedule } = status;
  const candidates = transactions
    .filter((t) => t.direction === "PAY" && t.frequency === "MONTHLY" && t.status === "PENDING" && (!t.loanId || t.loanId === loan.id) && t.id !== linked?.id)
    .map((t) => ({ id: t.id, title: t.title, amountPaise: t.amountPaise }));
  const interestLeft = schedule.rows.slice(status.paidInstalments).reduce((a, r) => a + r.interestPaise, 0);
  const step = Math.max(1, Math.floor(schedule.rows.length / 80));

  const archive = async () => {
    "use server";
    return archiveLoanAction(id);
  };

  // Amortisation grouped by year so a 20-year schedule stays readable.
  const years = new Map<string, typeof schedule.rows>();
  for (const r of schedule.rows) years.set(r.date.slice(0, 4), [...(years.get(r.date.slice(0, 4)) ?? []), r]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/loans" className="text-xs font-semibold text-ink-3 hover:text-ink">
            ← Loans & EMI
          </Link>
        }
        title={loan.name}
        description={`${loan.lender ?? "Loan"} · ${formatINR(loan.principalPaise)} at ${loan.annualRateBps / 100}% for ${loan.tenureMonths} months · first EMI ${formatDate(loan.firstEmiDate, today)}`}
        actions={
          <>
            <Link href={`/loans/${loan.id}/edit`} className={btnSecondary}>
              <Pencil width={14} height={14} /> Edit
            </Link>
            <ActionButton
              run={archive}
              redirectTo="/loans"
              successMessage="Loan archived. The EMI payment and its history are kept."
              confirm={{ title: `Archive ${loan.name}?`, body: "The loan is hidden. Its EMI payment item and payment history stay as they are.", label: "Archive" }}
              className={btnSecondary}
            >
              <Trash width={14} height={14} /> Archive
            </ActionButton>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric index={0} label="Outstanding principal" value={formatINR(status.outstandingPaise)} tone="out" sub={`after ${status.paidInstalments} EMIs`} />
        <Metric index={1} label="EMI" value={formatINR(loan.emiPaise)} sub={status.nextEmiDate ? `Next ${formatDate(status.nextEmiDate, today)}` : "Paid off"} />
        <Metric index={2} label="Interest still to pay" value={formatINR(interestLeft)} sub={`${formatINR(schedule.totalInterestPaise)} over the whole loan`} />
        <Metric
          index={3}
          label="Payoff"
          value={schedule.payoffDate ? formatDate(schedule.payoffDate, today) : "—"}
          sub={status.interestSavedPaise ? `Prepayments save ${formatINR(status.interestSavedPaise)}` : `${status.remainingInstalments} EMIs left`}
          tone={status.interestSavedPaise ? "gain" : "neutral"}
        />
      </section>

      {!schedule.payoffDate && <Note tone="warn">This EMI doesn&apos;t cover the monthly interest, so the loan never gets paid off. Check the EMI, rate and tenure.</Note>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Planned schedule including recorded prepayments">Outstanding over time</CardTitle>
          <LoanBalanceChart data={schedule.rows.filter((_, i) => i % step === 0).map((r) => ({ date: r.date, balance: r.closingPaise }))} />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle hint="One recurring payment tracks the EMIs, so they're never counted twice.">EMI payments</CardTitle>
            {linked ? (
              <div className="space-y-2 text-sm">
                <Link href={`/transactions/${linked.id}/edit`} className="font-semibold hover:underline">
                  {linked.title}
                </Link>
                <div className="text-ink-2">
                  {linked.status === "PENDING" ? (
                    linked.paused ? (
                      <Pill>Paused</Pill>
                    ) : (
                      <>Next due {formatDate(linked.dueDate, today)}</>
                    )
                  ) : (
                    "All paid"
                  )}
                </div>
                {loan.paidBeforeTracking > 0 && <p className="text-xs text-ink-3">Plus {loan.paidBeforeTracking} EMIs paid before tracking started.</p>}
              </div>
            ) : (
              <LinkEmiForm loanId={loan.id} candidates={candidates} />
            )}
          </Card>
          <Card>
            <CardTitle>Prepayments</CardTitle>
            {loan.prepayments.length > 0 && (
              <ul className="mb-4 divide-y divide-line text-sm">
                {loan.prepayments.map((p) => (
                  <li key={p.id} className="flex justify-between py-1.5">
                    <span className="text-ink-2">{formatDate(p.date, today)}</span>
                    <span className="num font-semibold">{formatINR(p.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
            <PrepaymentForm loanId={loan.id} today={today} />
          </Card>
        </div>
      </div>

      <Card>
        <CardTitle hint="Interest = outstanding × rate ÷ 12 each month, rounded to the paise. The last EMI absorbs rounding.">Amortisation schedule</CardTitle>
        <div className="space-y-2">
          {[...years.entries()].map(([year, rows]) => {
            const current = rows.some((r) => r.n === status.paidInstalments + 1);
            return (
              <details key={year} open={current} className="group rounded-xl border border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-semibold">{year}</span>
                  <span className="num text-xs text-ink-3">
                    Principal {formatINR(rows.reduce((a, r) => a + r.principalPaise + r.prepaymentPaise, 0))} · Interest {formatINR(rows.reduce((a, r) => a + r.interestPaise, 0))}
                  </span>
                </summary>
                <div className="px-2 pb-2">
                  <Table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th className="text-right">EMI</th>
                        <th className="text-right">Interest</th>
                        <th className="text-right">Principal</th>
                        <th className="text-right">Prepaid</th>
                        <th className="text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.n} className={r.n <= status.paidInstalments ? "text-ink-3" : r.n === status.paidInstalments + 1 ? "bg-pay-soft/50 font-medium" : ""}>
                          <td className="num">{r.n}</td>
                          <td className="whitespace-nowrap">
                            {formatDate(r.date, today)}
                            {r.n <= status.paidInstalments && <span className="ml-1 text-xs">✓</span>}
                          </td>
                          <td className="num text-right">{formatINR(r.emiPaise)}</td>
                          <td className="num text-right">{formatINR(r.interestPaise)}</td>
                          <td className="num text-right">{formatINR(r.principalPaise)}</td>
                          <td className="num text-right">{r.prepaymentPaise ? formatINR(r.prepaymentPaise) : "—"}</td>
                          <td className="num text-right">{formatINR(r.closingPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </details>
            );
          })}
        </div>
        <div className="mt-4">
          <Note>
            Illustrative fixed-rate schedule, not your lender&apos;s statement. Assumes the rate never changes, EMIs are paid on the due date, and prepayments shorten the tenure. Floating-rate loans, fees and broken-period interest will make the real figures differ.
          </Note>
        </div>
      </Card>
    </div>
  );
}
