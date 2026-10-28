import Link from "next/link";
import { formatDate, relativeDue } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { effectiveStatus } from "@/lib/status";
import type { ISODate, Transaction } from "@/lib/types";
import { DirectionBadge, FrequencyTag, StatusBadge } from "./Badges";
import { ArchiveButton, RestoreButton, RowShell, SettleButton } from "./ItemActions";
import { Alert, Pause, Pencil } from "./icons";

export function TransactionItem({
  tx,
  today,
  variant = "list",
  index = 0,
}: {
  tx: Transaction;
  today: ISODate;
  variant?: "dashboard" | "list";
  /** Position in the list, for the staggered entrance. */
  index?: number;
}) {
  const status = effectiveStatus(tx, today);
  const overdue = status === "OVERDUE";
  const open = tx.status === "PENDING" && !tx.paused;
  const rail = overdue ? "bg-overdue" : tx.direction === "PAY" ? "bg-pay" : "bg-receive";
  const editHref = `/transactions/${tx.id}/edit`;

  let dateLine: React.ReactNode;
  if (tx.paused && tx.status === "PENDING") {
    dateLine = <span className="text-ink-3">Paused · nothing due until resumed</span>;
  } else if (open) {
    dateLine = (
      <span className={overdue ? "inline-flex items-center gap-1 font-semibold text-overdue" : "text-ink-2"}>
        {overdue && <Alert width={13} height={13} />}
        {relativeDue(tx.dueDate, today)}
        {overdue && <span className="font-normal text-ink-3"> ({formatDate(tx.dueDate, today)})</span>}
      </span>
    );
  } else {
    const verb = tx.direction === "PAY" ? "Paid" : "Received";
    dateLine = (
      <span className="text-ink-3">
        {verb} {formatDate(tx.lastSettledOn ?? tx.dueDate, today)}
      </span>
    );
  }

  return (
    <RowShell collapseOnSettle={variant === "dashboard"}>
      <div className="rise" style={{ "--i": index } as React.CSSProperties}>
        <div
          className={`relative flex flex-col gap-3 overflow-hidden rounded-xl border py-3 pr-3 pl-5 transition-[background-color,border-color,box-shadow] duration-300 hover:shadow-[0_4px_16px_-8px_rgb(20_28_43/0.25)] sm:flex-row sm:items-center sm:gap-4 ${
            overdue
              ? "border-overdue/35 bg-overdue-soft/60 group-data-[phase=success]:border-receive/40 group-data-[phase=success]:bg-receive-soft"
              : "border-line bg-surface hover:border-line-strong group-data-[phase=success]:border-receive/40 group-data-[phase=success]:bg-receive-soft"
          } ${tx.archived ? "opacity-70" : ""}`}
        >
          <span
            aria-hidden
            className={`absolute top-3 bottom-3 left-0 w-1 rounded-r-full transition-colors duration-300 ${rail} group-data-[phase=success]:bg-receive`}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={editHref} className="truncate font-semibold text-ink hover:underline">
                {tx.title}
              </Link>
              {variant === "list" && <DirectionBadge direction={tx.direction} />}
              {variant === "list" && !tx.paused && <StatusBadge key={status} status={status} />}
              {tx.paused && (
                <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-2">
                  <Pause width={11} height={11} /> Paused
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              <span>{tx.category.name}</span>
              {tx.counterparty && <span className="text-ink-2">{tx.counterparty}</span>}
              <FrequencyTag frequency={tx.frequency} />
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 sm:block sm:text-right">
            <div className="text-sm sm:order-2">{dateLine}</div>
            <div
              className={`num text-lg font-bold sm:order-1 ${
                tx.direction === "RECEIVE" ? "text-receive-strong" : "text-ink"
              }`}
            >
              {tx.direction === "RECEIVE" ? "+" : ""}
              {formatINR(tx.amountPaise)}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:justify-end">
            {tx.archived ? (
              <RestoreButton id={tx.id} title={tx.title} />
            ) : (
              <>
                {open && <SettleButton id={tx.id} dueDate={tx.dueDate} direction={tx.direction} />}
                {variant === "list" && (
                  <>
                    <Link
                      href={editHref}
                      className="press group/edit inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-ink-2 hover:bg-canvas hover:text-ink"
                      aria-label={`Edit ${tx.title}`}
                    >
                      <Pencil
                        width={14}
                        height={14}
                        className="transition-transform duration-200 group-hover/edit:-rotate-12"
                      />{" "}
                      <span className="hidden sm:inline">Edit</span>
                    </Link>
                    <ArchiveButton id={tx.id} title={tx.title} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </RowShell>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  illustration,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  illustration?: React.ReactNode;
}) {
  return (
    <div className="fade-in rounded-xl border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center">
      {illustration && <div className="mx-auto mb-3 w-fit text-ink-3">{illustration}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-xs text-sm text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
