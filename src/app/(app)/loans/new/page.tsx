import { LoanForm } from "@/components/LoanForms";
import { PageHeader } from "@/components/ui";
import { loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add loan" };

export default async function NewLoanPage() {
  const user = await requireUser();
  const [today, { transactions }] = await Promise.all([getToday(), loadUserData(user.id)]);
  const candidates = transactions
    .filter((t) => t.direction === "PAY" && t.frequency === "MONTHLY" && t.status === "PENDING" && !t.loanId)
    // EMI-category payments first: they're the likely match.
    .sort((a, b) => Number(b.category.id === "PAY:EMI / Loan") - Number(a.category.id === "PAY:EMI / Loan"))
    .slice(0, 8)
    .map((t) => ({ id: t.id, title: t.title, amountPaise: t.amountPaise }));
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Add a loan" description="Use the figures from your loan agreement or statement." />
      <LoanForm today={today} emiCandidates={candidates} />
    </div>
  );
}
