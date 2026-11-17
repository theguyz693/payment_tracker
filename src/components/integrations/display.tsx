// Presentational pieces for the Integrations Hub (server-safe: no hooks).

import Link from "next/link";
import { EVENT_TYPE_LABEL, PROVIDERS, STATUS_LABEL, type EventStatus, type ProviderId } from "@/lib/integrations/types";
import { formatINR } from "@/lib/money";
import type { EventRow } from "@/server/integrations/queries";
import { Pill, Table } from "../ui";

const STATUS_TONE: Record<EventStatus, "gain" | "loss" | "pending" | "invest" | "neutral"> = {
  PROCESSED: "gain",
  FAILED: "loss",
  RETRY_PENDING: "pending",
  PROCESSING: "invest",
  RECEIVED: "neutral",
  DUPLICATE: "neutral",
};

export function StatusPill({ status }: { status: EventStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function PaymentPill({ status }: { status: "SUCCESS" | "PENDING" | "FAILED" | null }) {
  if (!status) return null;
  const tone = status === "SUCCESS" ? "gain" : status === "FAILED" ? "loss" : "pending";
  return <Pill tone={tone}>{status === "SUCCESS" ? "Success" : status === "FAILED" ? "Failed" : "Pending"}</Pill>;
}

/** Provider name with an explicit "simulated" marker; there are no real integrations. */
export function ProviderName({ id, short = false }: { id: ProviderId; short?: boolean }) {
  const name = PROVIDERS[id].name;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {short ? name.replace(" Simulator", "") : name}
      <span className="rounded border border-line-strong px-1 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">Sim</span>
    </span>
  );
}

export function formatTime(iso: string, tz: string, withDate = true): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: tz,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

/** Compact event list used by the hub overview and the console. */
export function EventTable({ rows, tz, empty = "No events yet." }: { rows: EventRow[]; tz: string; empty?: string }) {
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th>Event</th>
          <th className="hidden md:table-cell">Provider</th>
          <th className="text-right">Amount</th>
          <th>Status</th>
          <th className="hidden sm:table-cell">Received</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className="hover:bg-canvas/60">
            <td className="max-w-[16rem]">
              <Link href={`/integrations/events/${e.id}`} className="block font-medium text-ink hover:underline">
                {EVENT_TYPE_LABEL[e.eventType]}
                {e.counterparty && <span className="font-normal text-ink-2"> · {e.counterparty}</span>}
              </Link>
              <div className="truncate font-mono text-[11px] text-ink-3" title={e.externalEventId}>
                {shortId(e.externalEventId)}
              </div>
            </td>
            <td className="hidden text-ink-2 md:table-cell">
              <ProviderName id={e.provider} short />
            </td>
            <td className="num text-right whitespace-nowrap">{e.amountPaise !== null ? formatINR(e.amountPaise) : "—"}</td>
            <td>
              <div className="flex flex-wrap items-center gap-1">
                <StatusPill status={e.status} />
                {e.duplicateCount > 0 && <Pill tone="neutral">{e.duplicateCount} dup blocked</Pill>}
              </div>
            </td>
            <td className="hidden whitespace-nowrap text-xs text-ink-3 sm:table-cell">{formatTime(e.receivedAt, tz)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function SimulatedNotice() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-pending/30 bg-pending-soft px-3 py-2 text-xs text-pending">
      <span className="font-bold">SIMULATED</span>
      <span>
        Every provider here is a demo simulator. No real money moves, and nothing connects to Google Pay, PhonePe, Groww, UPI, a bank or a broker.
        Events are processed by the same pipeline a real integration would use.
      </span>
    </p>
  );
}
