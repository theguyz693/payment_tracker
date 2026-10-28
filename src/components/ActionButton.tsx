"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toast";
import { btnGhost } from "./ui";

/**
 * A button that runs a server action (optionally after confirmation),
 * then toasts and refreshes or navigates.
 */
export function ActionButton({
  run,
  children,
  confirm,
  successMessage,
  redirectTo,
  className = btnGhost,
  ariaLabel,
}: {
  run: () => Promise<{ ok: boolean; message?: string }>;
  children: React.ReactNode;
  confirm?: { title: string; body?: React.ReactNode; label: string; tone?: "danger" | "neutral" };
  successMessage?: string;
  redirectTo?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function go() {
    start(async () => {
      const r = await run();
      setOpen(false);
      if (r.ok) {
        toast(r.message ?? successMessage ?? "Done");
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast(r.message ?? "That didn't work. Please try again.", { tone: "error" });
      }
    });
  }

  return (
    <>
      <button type="button" disabled={pending} aria-label={ariaLabel} onClick={() => (confirm ? setOpen(true) : go())} className={className}>
        {pending && !confirm ? <span className="spinner" aria-hidden /> : null}
        {children}
      </button>
      {confirm && (
        <ConfirmDialog
          open={open}
          title={confirm.title}
          confirmLabel={confirm.label}
          busyLabel="Working…"
          busy={pending}
          tone={confirm.tone ?? "danger"}
          onConfirm={go}
          onClose={() => setOpen(false)}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </>
  );
}
