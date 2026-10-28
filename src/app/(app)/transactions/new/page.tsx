import { TransactionForm } from "@/components/TransactionForm";
import { listCategories } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add payment" };

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<{ direction?: string }> }) {
  await requireUser();
  const { direction } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Add payment</h1>
      <TransactionForm
        categories={listCategories()}
        today={await getToday()}
        defaultDirection={direction === "PAY" || direction === "RECEIVE" ? direction : undefined}
        returnTo="/dashboard"
      />
    </div>
  );
}
