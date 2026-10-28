import { notFound } from "next/navigation";
import { DirectionBadge, StatusBadge } from "@/components/Badges";
import { RestoreButton } from "@/components/ItemActions";
import { TransactionForm } from "@/components/TransactionForm";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { effectiveStatus } from "@/lib/status";
import { getHistory, getTransaction, listCategories } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit" };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Scoped to the signed-in user: another user's id is simply "not found".
  const [tx, history] = await Promise.all([getTransaction(user.id, id), getHistory(user.id, id)]);
  if (!tx) notFound();
  const categories = listCategories();
  const today = await getToday();
  const verb = tx.direction === "PAY" ? "Paid" : "Received";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <DirectionBadge direction={tx.direction} />
          <StatusBadge status={effectiveStatus(tx, today)} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Edit {tx.title}</h1>
      </div>

      {tx.archived && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-ink-2">This item is deleted and hidden from your dashboard and totals.</span>
          <RestoreButton id={tx.id} title={tx.title} inRow={false} />
        </div>
      )}

      <TransactionForm categories={categories} today={today} initial={tx} returnTo="/transactions" />

      <section>
        <h2 className="mb-3 text-lg font-bold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing {verb.toLowerCase()} yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {history.map((h, i) => (
              <li
                key={h.id}
                className="rise flex items-center justify-between px-4 py-2.5 text-sm"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span>
                  {verb} {formatDate(h.settledOn, today)}
                  <span className="ml-2 text-ink-3">for the {formatDate(h.dueDate, today)} due date</span>
                </span>
                <span className="num font-semibold">{formatINR(h.amountPaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
