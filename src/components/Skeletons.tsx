// Loading placeholders shown while a page's data loads (via loading.tsx).
// Shapes mirror the real layout so nothing jumps when content arrives.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function StatSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface px-4 py-3">
          <Bar className="h-3 w-20" />
          <Bar className="mt-2.5 h-6 w-28" />
          <Bar className="mt-2 h-3 w-16" />
        </div>
      ))}
    </>
  );
}

export function RowSkeletons({ count }: { count: number }) {
  return (
    <ul className="space-y-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4">
          <div className="flex-1">
            <Bar className="h-4 w-40 max-w-full" />
            <Bar className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <div className="flex flex-col items-end">
            <Bar className="h-3 w-20" />
            <Bar className="mt-2 h-5 w-24" />
          </div>
          <Bar className="hidden h-8 w-32 sm:block" />
        </li>
      ))}
    </ul>
  );
}

export function TitleSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div>
      <Bar className={`h-7 ${wide ? "w-80" : "w-48"} max-w-full`} />
      <Bar className="mt-2.5 h-4 w-64 max-w-full" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <TitleSkeleton wide />
      <div className="grid overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={`bg-surface px-6 py-5 ${i ? "border-t border-line sm:border-t-0 sm:border-l" : ""}`}>
            <Bar className="h-4 w-32" />
            <Bar className="mt-3 h-11 w-52" />
            <Bar className="mt-3 h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatSkeletons count={10} />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i}>
            <Bar className="mb-4 h-6 w-28" />
            <RowSkeletons count={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <TitleSkeleton />
      <div className="rounded-xl border border-line bg-surface p-3">
        <Bar className="h-10 w-full" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} className="h-14" />
          ))}
        </div>
      </div>
      <RowSkeletons count={6} />
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <div className="flex justify-between">
        <Bar className="h-7 w-52" />
        <Bar className="h-9 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatSkeletons count={5} />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Bar className="h-64" />
        <Bar className="h-64" />
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" role="status" aria-label="Loading">
      <Bar className="h-7 w-44" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Bar className="h-20" />
        <Bar className="h-20" />
      </div>
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-6">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}

/** Generic page: title, a row of figures and a few content cards. */
export function PageSkeleton({ stats = 4, cards = 2 }: { stats?: number; cards?: number }) {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <TitleSkeleton wide />
      {stats > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><StatSkeletons count={stats} /></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <Bar className="h-4 w-40" />
            <Bar className="mt-4 h-40 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
