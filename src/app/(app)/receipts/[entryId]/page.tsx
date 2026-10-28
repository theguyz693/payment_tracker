import Link from "next/link";
import { notFound } from "next/navigation";
import { ReceiptExperience } from "@/components/receipt/ReceiptExperience";
import { PageHeader } from "@/components/ui";
import { settlementReceipt } from "@/lib/receipt";
import { getSettlement } from "@/server/repository";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ entryId: string }> }) {
  const user = await requireUser();
  const { entryId } = await params;
  // Scoped to the signed-in user: someone else's entry id is simply "not found".
  const s = await getSettlement(user.id, entryId);
  if (!s) notFound();
  const receipt = settlementReceipt(s);

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          eyebrow={
            <Link href="/receipts" className="text-xs font-semibold text-ink-3 hover:text-ink">
              ← Receipts
            </Link>
          }
          title={`Receipt · ${s.title}`}
          description="A personal record from this app. It isn't a bank, payment-processor or tax receipt."
        />
      </div>
      <ReceiptExperience receipt={receipt} />
    </div>
  );
}
