import type { Direction, Frequency, Status } from "@/lib/types";
import { FREQUENCY_LABEL } from "@/lib/types";
import { Alert, ArrowIn, ArrowOut, Check, Clock, Repeat } from "./icons";

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

export function DirectionBadge({ direction }: { direction: Direction }) {
  return direction === "PAY" ? (
    <span className={`${pill} bg-pay-soft text-pay-strong`}>
      <ArrowOut width={12} height={12} /> Pay
    </span>
  ) : (
    <span className={`${pill} bg-receive-soft text-receive-strong`}>
      <ArrowIn width={12} height={12} /> Receive
    </span>
  );
}

const STATUS: Record<Status, { label: string; cls: string; Icon: typeof Check }> = {
  PENDING: { label: "Pending", cls: "bg-pending-soft text-pending", Icon: Clock },
  OVERDUE: { label: "Overdue", cls: "bg-overdue text-white", Icon: Alert },
  PAID: { label: "Paid", cls: "bg-settled-soft text-settled", Icon: Check },
  RECEIVED: { label: "Received", cls: "bg-settled-soft text-settled", Icon: Check },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, cls, Icon } = STATUS[status];
  return (
    <span className={`${pill} ${cls}`}>
      <Icon width={12} height={12} /> {label}
    </span>
  );
}

export function FrequencyTag({ frequency }: { frequency: Frequency }) {
  if (frequency === "ONE_TIME") return <span className="text-xs text-ink-3">One-time</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2">
      <Repeat width={12} height={12} /> {FREQUENCY_LABEL[frequency]}
    </span>
  );
}
