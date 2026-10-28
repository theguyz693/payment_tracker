import Link from "next/link";
import { Suspense } from "react";
import { FiltersBar } from "@/components/FiltersBar";
import { SearchIllustration, WalletIllustration } from "@/components/Illustrations";
import { plural } from "@/components/StatCard";
import { EmptyState, TransactionItem } from "@/components/TransactionItem";
import { Plus } from "@/components/icons";
import { Tabs } from "@/components/ui";
import { applyFilters, parseFilters } from "@/lib/filters";
import { formatINR } from "@/lib/money";
import { listCategories, loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const today = await getToday();
  const filters = parseFilters(await searchParams);
  const { transactions: all } = await loadUserData(user.id, { includeArchived: filters.status === "ARCHIVED" });
  const items = applyFilters(all, filters, today);
  const payTotal = items.filter((t) => t.direction === "PAY").reduce((s, t) => s + t.amountPaise, 0);
  const receiveTotal = items.filter((t) => t.direction === "RECEIVE").reduce((s, t) => s + t.amountPaise, 0);

  return (
    <div className="space-y-5">
      <Tabs
        active={filters.recurring ? "recurring" : "items"}
        tabs={[
          { key: "items", label: "All items", href: "/transactions" },
          { key: "recurring", label: "Recurring", href: "/transactions?view=recurring" },
          { key: "history", label: "History", href: "/transactions/history" },
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{filters.recurring ? "Recurring payments" : "Transactions"}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {plural(items.length, "item")}
          {payTotal > 0 && <span className="num ml-3">Pay {formatINR(payTotal)}</span>}
          {receiveTotal > 0 && <span className="num ml-3 text-receive-strong">Receive {formatINR(receiveTotal)}</span>}
        </p>
      </div>

      <Suspense>
        <FiltersBar categories={listCategories()} />
      </Suspense>

      {items.length === 0 ? (
        all.length === 0 && filters.status !== "ARCHIVED" ? (
          <EmptyState
            illustration={<WalletIllustration />}
            title="Nothing tracked yet."
            hint="Add your first payment or money you're expecting."
            action={
              <Link
                href="/transactions/new"
                className="press inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-on-ink hover:opacity-90"
              >
                <Plus width={14} height={14} /> Add Payment
              </Link>
            }
          />
        ) : (
          <EmptyState
            illustration={<SearchIllustration />}
            title={filters.status === "ARCHIVED" ? "No deleted items." : "No items match these filters."}
            hint={filters.status === "ARCHIVED" ? "Items you delete show up here so you can restore them." : "Try a different status or clear the filters."}
          />
        )
      ) : (
        <ul className="space-y-2">
          {items.map((t, i) => (
            <TransactionItem key={t.id} tx={t} today={today} variant="list" index={i} />
          ))}
        </ul>
      )}
    </div>
  );
}
