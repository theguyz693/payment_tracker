import Link from "next/link";
import { EmiCalculator } from "@/components/LoanForms";
import { Card, CardTitle, EmptyBlock, Metric, Note, PageHeader, ProgressBar, btnPrimary } from "@/components/ui";
import { Landmark, Plus } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loans & EMI" };

export default async function LoansPage() {
  const user = await requireUser();
  const today = await getToday();
  const { loans } = await loadFinancialPicture(user.id, today);
  const outstanding = loans.reduce((a, l) => a + l.status.outstandingPaise, 0);
  const monthlyEmi = loans.filter((l) => l.status.remainingInstalments > 0).reduce((a, l) => a + l.loan.emiPaise, 0);
  const interestLeft = loans.reduce((a, l) => a + l.status.schedule.rows.slice(l.status.paidInstalments).reduce((s, r) => s + r.interestPaise, 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Loans & EMI"
        description="Understand what you owe, what it costs, and how prepaying changes it."
        actions={
          <Link href="/loans/new" className={btnPrimary}>
            <Plus width={15} height={15} /> Add loan
          </Link>
        }
      />

      {loans.length > 0 ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric index={0} label="Outstanding principal" value={formatINR(outstanding)} tone="out" info="Estimated from each loan's schedule and the EMIs marked paid. Your lender's statement is the authority." />
            <Metric index={1} label="Monthly EMIs" value={formatINR(monthlyEmi)} sub={`${loans.length} loan${loans.length === 1 ? "" : "s"}`} />
            <Metric index={2} label="Interest still to pay" value={formatINR(interestLeft)} sub="If paid as scheduled" />
          </section>
          <section className="grid gap-4 md:grid-cols-2">
            {loans.map(({ loan, status, linked }, i) => {
              const progress = status.schedule.rows.length ? status.paidInstalments / status.schedule.rows.length : 0;
              return (
                <Link
                  key={loan.id}
                  href={`/loans/${loan.id}`}
                  className="rise group block rounded-2xl border border-line bg-surface p-4 hover:border-line-strong hover:shadow-[0_6px_20px_-12px_rgb(20_28_43/0.35)]"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold group-hover:underline">{loan.name}</div>
                      <div className="text-xs text-ink-3">
                        {loan.lender ?? "Loan"} · {loan.annualRateBps / 100}% · {loan.tenureMonths} months
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num font-bold">{formatINR(loan.emiPaise)}</div>
                      <div className="text-xs text-ink-3">EMI</div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between text-sm">
                    <span className="text-ink-2">Outstanding</span>
                    <span className="num font-semibold">{formatINR(status.outstandingPaise)}</span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={progress} tone="gain" label={`${loan.name} repaid`} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-ink-3">
                    <span>
                      {status.paidInstalments} of {status.schedule.rows.length} EMIs paid
                    </span>
                    <span>{status.nextEmiDate ? `Next ${formatDate(status.nextEmiDate, today)}` : "Paid off"}</span>
                  </div>
                  {!linked && <p className="mt-2 text-xs text-pending">EMI payments aren&apos;t being tracked. Link a payment on the loan page.</p>}
                </Link>
              );
            })}
          </section>
        </>
      ) : (
        <EmptyBlock icon={<Landmark width={20} height={20} />} title="No loans tracked" hint="Add a loan to see its schedule, what's outstanding and what prepaying would save. Or just use the calculator below." />
      )}

      <Card>
        <CardTitle hint="Fixed-rate, monthly reducing balance. Illustrative only.">EMI calculator</CardTitle>
        <EmiCalculator today={today} />
        <div className="mt-4">
          <Note>
            These are illustrative calculations, not your lender&apos;s repayment schedule. Real schedules can differ because of processing fees, broken-period interest, rate resets on floating loans and the lender&apos;s rounding.
          </Note>
        </div>
      </Card>
    </div>
  );
}
