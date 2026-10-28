import { notFound } from "next/navigation";
import { LoanForm } from "@/components/LoanForms";
import { PageHeader } from "@/components/ui";
import { getLoan } from "@/server/finance-repo";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit loan" };

export default async function EditLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [loan, today] = await Promise.all([getLoan(user.id, id), getToday()]);
  if (!loan) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Edit ${loan.name}`} description="Changing the terms recalculates the schedule. Recorded EMI payments and prepayments are kept." />
      <LoanForm initial={loan} today={today} emiCandidates={[]} />
    </div>
  );
}
