import Link from "next/link";
import { MandateForm } from "@/components/integrations/Controls";
import { ProviderName } from "@/components/integrations/display";
import { Card, CardTitle, EmptyBlock, Pill } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { FREQUENCY_LABEL } from "@/lib/types";
import { listConnections } from "@/server/integrations/operations";
import { listMandates } from "@/server/integrations/queries";
import { listCategories } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autopay · Integrations" };

const TONE = { ACTIVE: "gain", PAUSED: "pending", CANCELLED: "neutral" } as const;

export default async function AutopayPage() {
  const user = await requireUser();
  const [today, mandates, connections] = await Promise.all([getToday(), listMandates(user.id), listConnections(user.id)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-2">Mandates</h2>
        {mandates.length === 0 ? (
          <EmptyBlock title="No mandates yet" hint="Create one to simulate scheduled debits, failures, retries and duplicate attempts." />
        ) : (
          <ul className="space-y-2">
            {mandates.map((m) => (
              <li key={m.id}>
                <Link href={`/integrations/autopay/${m.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold">
                      {m.name} <Pill tone={TONE[m.status]}>{m.status.toLowerCase()}</Pill>
                    </div>
                    <div className="text-xs text-ink-3">
                      {m.payeeName} · {FREQUENCY_LABEL[m.frequency]} · <ProviderName id={m.provider} short />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num font-semibold">{formatINR(m.amountPaise)}</div>
                    <div className="text-xs text-ink-3">{m.completed ? "Completed" : m.nextDue ? `Next debit ${formatDate(m.nextDue, today)}` : "—"}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Card>
        <CardTitle hint="Creates the mandate and a recurring payment item. Successful debits mark that item's occurrences as paid.">New mandate</CardTitle>
        <MandateForm categories={listCategories()} today={today} connected={connections.autopay_sim?.status === "CONNECTED"} />
      </Card>
    </div>
  );
}
