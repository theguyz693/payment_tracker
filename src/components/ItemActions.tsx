"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { archiveAction, restoreAction, settleAction } from "@/server/actions";
import type { Direction } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Check, Trash } from "./icons";
import { useToast } from "./Toast";

// ---------------------------------------------------------------------------
// RowShell: wraps one transaction row and choreographs its state changes:
//   idle -> working (button spinner) -> success (✓ Paid) -> [leaving: collapse]
//   -> refresh data -> flash highlight on the updated row.
// The server action doesn't revalidate; we refresh after the success beat so
// the change is visible instead of the row jumping instantly.
// ---------------------------------------------------------------------------

type Phase = "idle" | "working" | "success" | "leaving";
interface RowApi {
  phase: Phase;
  settle: (id: string, dueDate: string) => void;
  remove: (run: () => Promise<boolean>, onDone: () => void) => void;
}
const RowContext = createContext<RowApi | null>(null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RowShell({
  children,
  collapseOnSettle,
}: {
  children: React.ReactNode;
  /** Collapse the row after settling (dashboard: the item moves or leaves the list). */
  collapseOnSettle: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [flash, setFlash] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const awaitingRefresh = useRef(false);

  useEffect(() => {
    if (!refreshing && awaitingRefresh.current) {
      awaitingRefresh.current = false;
      setPhase("idle");
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1100);
      return () => clearTimeout(t);
    }
  }, [refreshing]);

  const refresh = useCallback(() => {
    awaitingRefresh.current = true;
    startRefresh(() => router.refresh());
  }, [router]);

  const settle = useCallback(
    async (id: string, dueDate: string) => {
      setPhase("working");
      const res = await settleAction(id, dueDate).catch(() => null);
      if (!res?.ok) {
        setPhase("idle");
        toast(res?.message ?? "Couldn't reach the server. Check your connection.", { tone: "error" });
        return;
      }
      setPhase("success");
      toast(res.message);
      await sleep(650);
      if (collapseOnSettle || res.nextDue === null) {
        setPhase("leaving");
        await sleep(280);
      }
      refresh();
    },
    [collapseOnSettle, refresh, toast],
  );

  const remove = useCallback(
    async (run: () => Promise<boolean>, onDone: () => void) => {
      const ok = await run().catch(() => false);
      if (!ok) {
        toast("Couldn't update that item. Try again.", { tone: "error" });
        return;
      }
      onDone();
      setPhase("leaving");
      await sleep(280);
      refresh();
    },
    [refresh, toast],
  );

  return (
    <RowContext.Provider value={{ phase, settle, remove }}>
      <li className="row-shell group" data-phase={phase} data-flash={flash || undefined}>
        {children}
      </li>
    </RowContext.Provider>
  );
}

function useRow(): RowApi {
  const ctx = useContext(RowContext);
  if (!ctx) throw new Error("Row actions must be inside <RowShell>");
  return ctx;
}

// ---------------------------------------------------------------------------

export function SettleButton({ id, dueDate, direction }: { id: string; dueDate: string; direction: Direction }) {
  const { phase, settle } = useRow();
  const pay = direction === "PAY";
  const done = phase === "success" || phase === "leaving";

  return (
    <button
      type="button"
      disabled={phase !== "idle"}
      onClick={() => settle(id, dueDate)}
      aria-live="polite"
      className={`press inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white disabled:cursor-default ${
        done
          ? "bg-receive"
          : pay
            ? "bg-pay hover:bg-pay-hover disabled:opacity-80"
            : "bg-receive hover:bg-receive-hover disabled:opacity-80"
      }`}
    >
      {phase === "working" ? (
        <>
          <span className="spinner" aria-hidden /> Saving…
        </>
      ) : done ? (
        <>
          <Check width={14} height={14} className="pop" strokeWidth={3} /> {pay ? "Paid" : "Received"}
        </>
      ) : (
        <>
          <Check width={14} height={14} /> {pay ? "Mark as Paid" : "Mark as Received"}
        </>
      )}
    </button>
  );
}

/** Delete = archive, after a confirmation dialog. The toast offers Undo. */
export function ArchiveButton({ id, title }: { id: string; title: string }) {
  const { remove } = useRow();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    await remove(
      async () => (await archiveAction(id)).ok,
      () => {
        setOpen(false);
        toast(`${title} deleted`, {
          action: {
            label: "Undo",
            onClick: async () => {
              const res = await restoreAction(id);
              if (res.ok) {
                toast(`${title} restored`);
                router.refresh();
              }
            },
          },
        });
      },
    );
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-ink-3 hover:bg-overdue-soft hover:text-overdue"
        aria-label={`Delete ${title}`}
      >
        <Trash width={14} height={14} /> <span className="hidden sm:inline">Delete</span>
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete “${title}”?`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={busy}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      >
        It will disappear from your lists and totals. Its history is kept, and you can restore it from{" "}
        <strong className="font-semibold text-ink">Status → Deleted</strong> on the Transactions page.
      </ConfirmDialog>
    </>
  );
}

export function RestoreButton({ id, title, inRow = true }: { id: string; title: string; inRow?: boolean }) {
  const row = useContext(RowContext);
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    if (inRow && row) {
      await row.remove(
        async () => (await restoreAction(id)).ok,
        () => toast(`${title} restored`),
      );
    } else {
      const res = await restoreAction(id);
      if (res.ok) {
        toast(`${title} restored`);
        start(() => router.refresh());
      }
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      disabled={busy || pending}
      onClick={restore}
      className="press inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
    >
      {(busy || pending) && <span className="spinner" aria-hidden />}
      Restore
    </button>
  );
}
