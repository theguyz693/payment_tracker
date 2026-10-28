"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Alert, Check } from "./icons";

interface ToastOptions {
  tone?: "success" | "error";
  action?: { label: string; onClick: () => void };
  duration?: number;
}
type Toast = ToastOptions & { id: number; text: string; leaving: boolean };
type ShowToast = (text: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 200);
  }, []);

  const show = useCallback<ShowToast>(
    (text, opts = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, text, leaving: false, ...opts }]);
      setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 3500));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-5"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl bg-ink py-2.5 pr-2.5 pl-4 text-sm font-medium text-on-ink shadow-lg"
            style={{
              animation: t.leaving
                ? "toast-out 0.2s ease-in both"
                : "toast-in 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {t.tone === "error" ? (
              <Alert width={16} height={16} className="shrink-0 text-overdue" />
            ) : (
              <Check width={16} height={16} className="pop shrink-0 text-success-icon" />
            )}
            <span className="pr-1.5">{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="press shrink-0 rounded-md px-2 py-1 text-sm font-semibold underline-offset-2 hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
