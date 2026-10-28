"use client";

import Link from "next/link";
import { useEffect } from "react";

// Shown when a page in the app fails to load (e.g. the database is unreachable).
// Nothing is lost: data is only changed by explicit actions.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <h1 className="text-xl font-bold">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-ink-2">Something went wrong while fetching your data. Your records are safe. Try again in a moment.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className="press rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink hover:opacity-90">
          Try again
        </button>
        <Link href="/dashboard" className="press rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-canvas">
          Go to overview
        </Link>
      </div>
      {error.digest && <p className="mt-4 text-xs text-ink-3">Reference: {error.digest}</p>}
    </div>
  );
}
