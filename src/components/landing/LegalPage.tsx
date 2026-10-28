import Link from "next/link";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page-enter mx-auto max-w-2xl px-5 py-16 sm:py-24">
      <Link href="/" className="press inline-flex items-center gap-2 font-bold tracking-tight">
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-ink text-[13px] font-extrabold text-on-ink">
          ₹
        </span>
        Payment Tracker
      </Link>
      <h1 className="mt-12 text-4xl font-extrabold tracking-[-0.03em]">{title}</h1>
      <div className="mt-8 space-y-5 leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink">
        {children}
      </div>
    </div>
  );
}
