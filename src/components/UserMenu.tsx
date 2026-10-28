"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { LogOut, Monitor, Moon, Sun } from "./icons";
import { useToast } from "./Toast";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return [
    theme,
    (t: Theme) => {
      setTheme(t);
      try {
        if (t === "system") localStorage.removeItem("theme");
        else localStorage.setItem("theme", t);
      } catch {}
      applyTheme(t);
    },
  ];
}

export function UserMenu({ user, placement = "down" }: { user: { name: string; email: string }; placement?: "down" | "up" }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toast = useToast();
  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || user.email[0]!.toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      // Better Auth reports failures in the result rather than throwing.
      const { error } = await authClient.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
      toast("Logged out");
    } catch {
      setSigningOut(false);
      toast("Couldn't log out. Check your connection.", { tone: "error" });
    }
  }

  const themes: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "Auto", Icon: Monitor },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="press grid size-9 place-items-center rounded-full border border-line-strong bg-canvas text-xs font-bold text-ink hover:border-ink-3"
      >
        {initials}
      </button>

      <div
        role="menu"
        data-open={open || undefined}
        className={`invisible absolute z-50 w-64 scale-95 ${placement === "up" ? "bottom-full left-0 mb-2 origin-bottom-left" : "right-0 mt-2 origin-top-right"} rounded-xl border border-line bg-surface p-1.5 opacity-0 shadow-xl transition-[opacity,transform,visibility] duration-150 ease-out data-open:visible data-open:scale-100 data-open:opacity-100`}
      >
        <div className="px-2.5 pt-1.5 pb-2.5">
          <div className="truncate text-sm font-semibold">{user.name || "Your account"}</div>
          <div className="truncate text-xs text-ink-3">{user.email}</div>
        </div>
        <div className="border-t border-line px-2.5 py-2.5">
          <div className="mb-1.5 text-xs font-medium text-ink-3">Appearance</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-canvas p-1" role="radiogroup" aria-label="Theme">
            {themes.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                tabIndex={open ? 0 : -1}
                onClick={() => setTheme(value)}
                className="press flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold text-ink-2 aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-sm"
              >
                <Icon width={13} height={13} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-line pt-1.5">
          <button
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={signOut}
            disabled={signingOut}
            className="press flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-2 hover:bg-canvas hover:text-ink disabled:opacity-60"
          >
            {signingOut ? <span className="spinner" aria-hidden /> : <LogOut width={15} height={15} />}
            {signingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>
  );
}
