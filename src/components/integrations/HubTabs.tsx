"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "../ui";

const TABS = [
  { key: "overview", label: "Overview", href: "/integrations" },
  { key: "simulate", label: "Simulators", href: "/integrations/simulate" },
  { key: "requests", label: "Requests", href: "/integrations/requests" },
  { key: "autopay", label: "Autopay", href: "/integrations/autopay" },
  { key: "events", label: "Event console", href: "/integrations/events" },
  { key: "monitoring", label: "Monitoring", href: "/integrations/monitoring" },
];

export function HubTabs() {
  const pathname = usePathname();
  const active = TABS.slice(1).find((t) => pathname.startsWith(t.href))?.key ?? "overview";
  return <Tabs tabs={TABS} active={active} />;
}
