"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Accessible confirmation dialog built on native <dialog>
 * (focus trapping, Escape to close, inert background) with a short
 * open/close animation.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"open" | "closing" | "closed">("closed");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setState("open");
    } else if (!open && dialog.open) {
      setState("closing");
      const t = setTimeout(() => {
        dialog.close();
        setState("closed");
      }, 170);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      data-state={state}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="flex h-full items-end justify-center p-4 sm:items-center">
        <div
          className="modal-overlay absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={() => !busy && onClose()}
          aria-hidden
        />
        <div className="modal-panel relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl">
          <h2 id="confirm-title" className="text-lg font-bold">
            {title}
          </h2>
          {children && <div className="mt-1.5 text-sm text-ink-2">{children}</div>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              autoFocus
              className="press rounded-lg px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-canvas disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`press inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-70 ${
                tone === "danger" ? "bg-overdue hover:brightness-110" : "bg-pay hover:bg-pay-hover"
              }`}
            >
              {busy && <span className="spinner" aria-hidden />}
              {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
