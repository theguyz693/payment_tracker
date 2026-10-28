"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert, Eye, EyeOff } from "./icons";
import { useToast } from "./Toast";

type Mode = "login" | "signup";
type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only allow same-site relative redirects after login. */
function safeNext(next?: string): string {
  return next && /^\/(?!\/)/.test(next) && !next.startsWith("/login") && !next.startsWith("/signup") ? next : "/dashboard";
}

function friendlyError(err: { status?: number; code?: string; message?: string }, mode: Mode): string {
  const code = err.code ?? "";
  if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "Email or password is incorrect.";
  if (code.startsWith("USER_ALREADY_EXISTS")) return "An account with this email already exists. Log in instead.";
  if (code === "PASSWORD_TOO_SHORT") return "Use at least 8 characters for your password.";
  if (code === "INVALID_EMAIL") return "Enter a valid email address.";
  return mode === "login" ? "Couldn't log you in. Please try again." : "Couldn't create your account. Please try again.";
}

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  function validate(): Errors {
    const e: Errors = {};
    if (signup && !name.trim()) e.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
    if (signup ? password.length < 8 : !password) e.password = signup ? "Use at least 8 characters." : "Enter your password.";
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const { error } = signup
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password, rememberMe: true });
      if (error) {
        setErrors({ form: friendlyError(error, mode) });
        setBusy(false);
        return;
      }
      if (signup) toast(`Welcome, ${name.trim().split(" ")[0]}!`);
      router.replace(safeNext(next));
      router.refresh();
    } catch {
      setErrors({ form: "Couldn't reach the server. Check your connection and try again." });
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_8px_30px_-12px_rgb(20_28_43/0.18)] sm:p-7">
      <h1 className="text-xl font-bold tracking-tight">{signup ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-1 text-sm text-ink-2">
        {signup ? "Track what you need to pay and what you're owed." : "Log in to see what's due."}
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {errors.form && (
          <p role="alert" className="fade-in flex items-start gap-2 rounded-lg bg-overdue-soft px-3 py-2.5 text-sm text-overdue">
            <Alert width={16} height={16} className="mt-0.5 shrink-0" />
            {errors.form}
          </p>
        )}

        {signup && (
          <Field label="Your name" error={errors.name}>
            <input
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className={inputCls(errors.name)}
              autoFocus
            />
          </Field>
        )}
        <Field label="Email" error={errors.email}>
          <input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            className={inputCls(errors.email)}
            autoFocus={!signup}
          />
        </Field>
        <Field label="Password" error={errors.password} hint={signup ? "At least 8 characters." : undefined}>
          <div className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              className={`${inputCls(errors.password)} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="press absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-canvas hover:text-ink"
            >
              {showPassword ? <EyeOff width={16} height={16} /> : <Eye width={16} height={16} />}
            </button>
          </div>
        </Field>

        <button
          type="submit"
          disabled={busy}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:opacity-90 disabled:opacity-70"
        >
          {busy && <span className="spinner" aria-hidden />}
          {busy ? (signup ? "Creating account…" : "Logging in…") : signup ? "Create account" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-2">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? "/login" : "/signup"} className="font-semibold text-ink underline-offset-2 hover:underline">
          {signup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="fade-in mt-1 block text-xs font-medium text-overdue">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

function inputCls(error?: string) {
  return `block w-full rounded-lg border bg-surface px-3 py-2.5 text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:outline-none focus:ring-2 ${
    error ? "border-overdue focus:ring-overdue/30" : "border-line-strong hover:border-ink-3 focus:border-pay focus:ring-pay/20"
  }`;
}
