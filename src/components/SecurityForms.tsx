"use client";

// Account security actions. They call Better Auth's own endpoints, which
// verify the session and (where needed) the current password server-side.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Field, inputCls } from "./forms";
import { useToast } from "./Toast";
import { btnSecondary } from "./ui";

function message(err: { status?: number; code?: string; message?: string }): string {
  if (err.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (err.code === "INVALID_PASSWORD") return "That password is incorrect.";
  if (err.code === "PASSWORD_TOO_SHORT") return "Use at least 8 characters.";
  if (err.code === "PASSWORD_TOO_LONG") return "Use at most 128 characters.";
  return err.message && err.message.length < 120 ? err.message : "That didn't work. Please try again.";
}

export function ChangePasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("Use at least 8 characters for the new password.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setError(message(error));
    setCurrent("");
    setNext("");
    setConfirm("");
    toast("Password changed. Other devices have been signed out.");
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={128} className={inputCls()} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password" hint="At least 8 characters.">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} className={inputCls()} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} className={inputCls()} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-overdue-soft px-3 py-2 text-sm text-overdue">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !current || !next} className={btnSecondary}>
        {busy && <span className="spinner" aria-hidden />} Change password
      </button>
    </form>
  );
}

export function SignOutOthersButton({ others }: { others: number }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const { error } = await authClient.revokeOtherSessions();
    setBusy(false);
    if (error) return toast(message(error), { tone: "error" });
    toast("Signed out of every other device.");
    router.refresh();
  }
  return (
    <button type="button" onClick={run} disabled={busy || others === 0} className={btnSecondary}>
      {busy && <span className="spinner" aria-hidden />} Sign out all other devices
    </button>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = typed === "DELETE" && password.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      setBusy(false);
      return setError(message(error));
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <p className="text-sm text-ink-2">
        This permanently deletes <strong>{email}</strong> and everything in it: payments and their history, goals, loans, investments and settings. It can&apos;t be undone. Download your data first if you might want it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} className={inputCls()} />
        </Field>
        <Field label='Type "DELETE" to confirm'>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputCls()} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-overdue-soft px-3 py-2 text-sm text-overdue">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!ready || busy}
        className="press inline-flex items-center gap-2 rounded-lg bg-overdue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy && <span className="spinner" aria-hidden />} Delete my account permanently
      </button>
    </form>
  );
}
