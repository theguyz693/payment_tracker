"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Refresh } from "./icons";

function ago(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** "Updated just now" + a refresh button. `at` is when the server rendered the data. */
export function LastUpdated({ at }: { at: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [at]);

  const label = now === null ? "just now" : ago(Math.max(0, now - new Date(at).getTime()));

  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="press group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface hover:text-ink"
      title="Refresh"
    >
      <Refresh
        width={13}
        height={13}
        className={pending ? "animate-[spin_0.8s_linear_infinite]" : "transition-transform duration-300 group-hover:rotate-90"}
      />
      {pending ? "Refreshing…" : `Updated ${label}`}
    </button>
  );
}
