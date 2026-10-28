import { notFound } from "next/navigation";
import { HoldingForm } from "@/components/InvestmentForms";
import { PageHeader } from "@/components/ui";
import { getHolding } from "@/server/investments-repo";
import { alphaVantageEnabled } from "@/server/prices";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit investment" };

export default async function EditInvestmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const holding = await getHolding(user.id, id);
  if (!holding) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Edit ${holding.name}`} description="Recorded transactions are kept as they are." />
      <HoldingForm initial={holding} livePricesForStocks={alphaVantageEnabled()} />
    </div>
  );
}
