import { RequestSimulator, TradeSimulator, UpiSimulator } from "@/components/integrations/Simulators";
import { Card, CardTitle, Tabs } from "@/components/ui";
import { listConnections } from "@/server/integrations/operations";
import { listCategories } from "@/server/repository";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulators · Integrations" };

const TABS = [
  { key: "upi", label: "UPI payments", href: "/integrations/simulate" },
  { key: "request", label: "Payment request", href: "/integrations/simulate?tab=request" },
  { key: "invest", label: "Investment import", href: "/integrations/simulate?tab=invest" },
];

export default async function SimulatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "request" || sp.tab === "invest" ? sp.tab : "upi";
  const [connections, today] = await Promise.all([listConnections(user.id), getToday()]);
  const connected = Object.fromEntries(Object.entries(connections).map(([k, v]) => [k, v?.status === "CONNECTED"]));

  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} active={tab} />
      <Card>
        {tab === "upi" && (
          <>
            <CardTitle hint="Builds a Google Pay- or PhonePe-shaped webhook payload, signs it and delivers it to the pipeline. Only a processed event records a transaction.">
              Simulate a UPI payment
            </CardTitle>
            <UpiSimulator categories={listCategories()} connected={connected} />
          </>
        )}
        {tab === "request" && (
          <>
            <CardTitle hint="A demo contact asks you for money. Accept or reject it on the Requests tab.">Simulate an incoming payment request</CardTitle>
            <RequestSimulator connected={!!connected.requests_sim} />
          </>
        )}
        {tab === "invest" && (
          <>
            <CardTitle hint="An executed order from the Groww Simulator, imported into your investments.">Simulate an investment import</CardTitle>
            <TradeSimulator connected={!!connected.groww_sim} today={today} />
          </>
        )}
      </Card>
    </div>
  );
}
