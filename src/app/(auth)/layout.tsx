import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="page-enter w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-lg font-bold tracking-tight">
          <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-extrabold text-on-ink">
            ₹
          </span>
          Payment Tracker
        </Link>
        {children}
      </div>
    </main>
  );
}
