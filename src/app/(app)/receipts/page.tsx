import Link from "next/link";
import { MockBillForm } from "@/components/receipt/MockBillForm";
import { Card, CardTitle, EmptyBlock, Note, PageHeader } from "@/components/ui";
import { ReceiptIcon } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { loadUserData } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipts" };

export default async function ReceiptsPage() {
  const user = await requireUser();
  const [today, { settlements }] = await Promise.all([getToday(), loadUserData(user.id)]);
  // Only entries with a stable id can have a receipt (older ones get one on load).
  const recent = settlements.filter((s) => /^[a-f\d]{24}$/i.test(s.id)).slice(0, 12);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Receipts"
        description="Print a receipt-style record of a payment you've made or received, or make a sample bill for fun. These are personal records, not bank, payment-processor or tax receipts."
      />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Pick a payment to print its record">Recent payments</CardTitle>
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/receipts/${s.id}`} className="group flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">{s.title}</span>
                      <span className="text-xs text-ink-3">
                        {s.direction === "PAY" ? "Paid" : "Received"} {formatDate(s.settledOn, today)} · {s.categoryName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`num font-semibold ${s.direction === "RECEIVE" ? "text-receive-strong" : ""}`}>{formatINR(s.amountPaise)}</span>
                      <ReceiptIcon width={15} height={15} className="text-ink-3 group-hover:text-ink" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBlock icon={<ReceiptIcon width={20} height={20} />} title="No payments yet" hint="Mark something as paid or received and you can print its record here." />
          )}
        </Card>
        <Card>
          <CardTitle hint="Clearly labelled SAMPLE. Nothing is saved.">Sample bill generator</CardTitle>
          <MockBillForm today={today} />
        </Card>
      </div>
      <Note>Receipt numbers (PT-date-code) come from the payment record so the same payment always prints the same number.</Note>
    </div>
  );
}
