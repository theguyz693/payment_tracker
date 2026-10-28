import { HoldingForm } from "@/components/InvestmentForms";
import { PageHeader } from "@/components/ui";
import { alphaVantageEnabled } from "@/server/prices";
import { requireUser } from "@/server/session";

export const metadata = { title: "Add investment" };

export default async function NewInvestmentPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Add an investment" description="Create the holding first, then record your purchases on its page." />
      <HoldingForm livePricesForStocks={alphaVantageEnabled()} />
    </div>
  );
}
