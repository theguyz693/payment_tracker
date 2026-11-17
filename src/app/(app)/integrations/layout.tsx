import { HubTabs } from "@/components/integrations/HubTabs";
import { SimulatedNotice } from "@/components/integrations/display";
import { PageHeader } from "@/components/ui";

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Integrations Hub"
        description="Simulated external providers send events into your tracker. Each one is authenticated, validated, de-duplicated and processed once."
      />
      <SimulatedNotice />
      <HubTabs />
      <div>{children}</div>
    </div>
  );
}
