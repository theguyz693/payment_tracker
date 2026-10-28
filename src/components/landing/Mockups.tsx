// Static, non-interactive renderings of the real app UI for the landing page.
// They use the same tokens, type and row anatomy as the dashboard, so the
// preview looks like the product — but nothing here is clickable.

import { Alert, ArrowIn, ArrowOut, Check, Plus, Repeat } from "../icons";

type Dir = "PAY" | "RECEIVE";

export function MockRow({
  title,
  meta,
  due,
  amount,
  direction,
  overdue = false,
  recurring = false,
  compact = false,
}: {
  title: string;
  meta: string[];
  due: string;
  amount: string;
  direction: Dir;
  overdue?: boolean;
  recurring?: boolean;
  compact?: boolean;
}) {
  const pay = direction === "PAY";
  const rail = overdue ? "bg-overdue" : pay ? "bg-pay" : "bg-receive";
  return (
    <div
      className={`relative flex items-center gap-3 overflow-hidden rounded-xl border pr-3 pl-4 ${compact ? "py-2.5" : "py-3"} ${
        overdue ? "border-overdue/30 bg-overdue-soft/60" : "border-line bg-surface"
      }`}
    >
      <span aria-hidden className={`absolute top-2.5 bottom-2.5 left-0 w-1 rounded-r-full ${rail}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink sm:text-sm">{title}</div>
        <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-ink-3">
          {meta.map((m) => (
            <span key={m} className="truncate">
              {m}
            </span>
          ))}
          {recurring && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-ink-2">
              <Repeat width={10} height={10} /> Monthly
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`num text-sm font-bold sm:text-[15px] ${pay ? "text-ink" : "text-receive-strong"}`}>
          {pay ? "" : "+"}
          {amount}
        </div>
        <div className={`mt-0.5 text-[11px] ${overdue ? "inline-flex items-center gap-0.5 font-semibold text-overdue" : "text-ink-2"}`}>
          {overdue && <Alert width={10} height={10} />}
          {due}
        </div>
      </div>
      <span
        aria-hidden
        className={`hidden shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white min-[420px]:inline-flex ${
          pay ? "bg-pay" : "bg-receive"
        }`}
      >
        <Check width={11} height={11} />
        {pay ? "Pay" : "Receive"}
      </span>
    </div>
  );
}

/** The floating composition in the hero. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[540px] select-none lg:mx-0" aria-hidden>
      {/* soft light behind the cards */}
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[48px] bg-[radial-gradient(60%_55%_at_60%_40%,var(--color-pay-soft),transparent_70%)] opacity-90" />

      <div className="hero-in" style={{ "--d": 2 } as React.CSSProperties}>
        <div className="float-slow">
          <div className="shadow-product rounded-[22px] border border-line/80 bg-surface/90 p-4 backdrop-blur-xl sm:p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-bold text-ink">This week</div>
                <div className="text-[11px] text-ink-3">2 to pay, 1 to receive</div>
              </div>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-pay-soft px-2 py-0.5 text-[10px] font-semibold text-pay-strong">Pay ₹25,649</span>
                <span className="hidden rounded-full bg-receive-soft px-2 py-0.5 text-[10px] font-semibold text-receive-strong min-[380px]:inline">
                  Receive ₹18,000
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <MockRow title="Home Rent" meta={["Rent", "Landlord"]} due="Due today" amount="₹25,000" direction="PAY" recurring />
              <MockRow
                title="Rent from Rahul"
                meta={["Rent Received", "Apartment 2"]}
                due="Expected tomorrow"
                amount="₹18,000"
                direction="RECEIVE"
                recurring
              />
              <MockRow title="Netflix" meta={["Subscription"]} due="Due in 5 days" amount="₹649" direction="PAY" compact />
            </div>
          </div>
        </div>
      </div>

      {/* Monthly summary card */}
      <div
        className="hero-in relative z-10 -mt-6 ml-auto w-[78%] max-w-[300px] sm:absolute sm:-bottom-36 sm:-left-8 sm:mt-0 sm:ml-0 sm:w-[260px]"
        style={{ "--d": 4 } as React.CSSProperties}
      >
        <div className="float-slower">
          <div className="shadow-product rounded-[18px] border border-line/80 bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink">This month</span>
              <span className="text-[10px] text-ink-3">Summary</span>
            </div>
            <dl className="mt-3 space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <span className="grid size-4 place-items-center rounded bg-receive-soft text-receive-strong">
                    <ArrowIn width={10} height={10} />
                  </span>
                  Received
                </dt>
                <dd className="num font-semibold text-ink">₹98,000</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <span className="grid size-4 place-items-center rounded bg-pay-soft text-pay-strong">
                    <ArrowOut width={10} height={10} />
                  </span>
                  Paid
                </dt>
                <dd className="num font-semibold text-ink">₹61,400</dd>
              </div>
            </dl>
            <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              <span className="bar-grow h-full rounded-full bg-receive" style={{ width: "61%" }} />
              <span className="bar-grow h-full rounded-full bg-pay" style={{ width: "39%", "--i": 2 } as React.CSSProperties} />
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-2.5">
              <span className="text-[11px] text-ink-3">Net</span>
              <span className="num text-base font-extrabold text-receive-strong">+₹36,600</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation toast, as shown in the app */}
      <div
        className="hero-in absolute -top-5 right-2 hidden sm:block xl:-right-6"
        style={{ "--d": 6 } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2 text-[12px] font-medium text-on-ink shadow-lg">
          <Check width={13} height={13} className="text-success-icon" strokeWidth={3} />
          Electricity marked as paid
        </div>
      </div>
    </div>
  );
}

function MockStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "pay" | "receive" | "overdue" }) {
  const box = tone === "overdue" ? "border-overdue/35 bg-overdue-soft" : "border-line bg-surface";
  const val =
    tone === "pay" ? "text-pay-strong" : tone === "receive" ? "text-receive-strong" : tone === "overdue" ? "text-overdue" : "text-ink";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${box}`}>
      <div className="text-[10px] font-medium text-ink-2 sm:text-[11px]">{label}</div>
      <div className={`num mt-0.5 text-sm font-bold sm:text-base ${val}`}>{value}</div>
      <div className="text-[10px] text-ink-3">{sub}</div>
    </div>
  );
}

/** Full dashboard preview for the showcase section. */
export function DashboardMockup() {
  return (
    <div className="shadow-product overflow-hidden rounded-[24px] border border-line bg-canvas" aria-hidden>
      {/* app header */}
      <div className="flex h-12 items-center gap-4 border-b border-line bg-surface/90 px-4 sm:px-6">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <span className="grid size-6 place-items-center rounded-md bg-ink text-[11px] font-extrabold text-on-ink">₹</span>
          <span className="hidden sm:inline">Payment Tracker</span>
        </div>
        <div className="hidden items-center gap-1 text-[12px] font-medium text-ink-2 md:flex">
          <span className="rounded-md bg-canvas px-2 py-1 text-ink">Dashboard</span>
          <span className="px-2 py-1">Transactions</span>
          <span className="px-2 py-1">Summary</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-on-ink sm:inline-flex">
            <Plus width={12} height={12} /> Add Payment
          </span>
          <span className="grid size-7 place-items-center rounded-full border border-line-strong bg-canvas text-[10px] font-bold">MS</span>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        <div>
          <div className="text-base font-bold tracking-tight sm:text-lg">What&apos;s happening with your money</div>
          <div className="text-[11px] text-ink-2 sm:text-xs">Totals cover the next 30 days, plus anything overdue.</div>
        </div>

        <div className="grid overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
          <div className="bg-pay-soft px-4 py-4">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-pay-strong">
              <ArrowOut width={12} height={12} /> You need to pay
            </div>
            <div className="num mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">₹41,248</div>
            <div className="mt-1 text-[11px] text-ink-2">
              5 payments <span className="ml-1 rounded-full bg-overdue px-1.5 py-0.5 text-[10px] font-semibold text-white">₹12,500 overdue</span>
            </div>
          </div>
          <div className="border-t border-line bg-receive-soft px-4 py-4 sm:border-t-0 sm:border-l">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-receive-strong">
              <ArrowIn width={12} height={12} /> You&apos;ll receive
            </div>
            <div className="num mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">₹1,13,000</div>
            <div className="mt-1 text-[11px] text-ink-2">3 payments</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <MockStat label="Due today" value="₹2,100" sub="1 payment" tone="pay" />
          <MockStat label="Due this week" value="₹28,099" sub="3 payments" tone="pay" />
          <MockStat label="Overdue" value="₹12,500" sub="1 payment late" tone="overdue" />
          <MockStat label="Paid this month" value="₹61,400" sub="9 payments" />
          <div className="hidden sm:block">
            <MockStat label="Net cash flow" value="+₹36,600" sub="Received − paid" tone="receive" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <span className="grid size-5 place-items-center rounded-md bg-pay text-white">
                <ArrowOut width={11} height={11} />
              </span>
              To pay
            </div>
            <div className="space-y-2">
              <MockRow title="Car EMI" meta={["EMI / Loan", "HDFC Bank"]} due="3 days overdue" amount="₹12,500" direction="PAY" overdue compact />
              <MockRow title="Electricity" meta={["Electricity", "BESCOM"]} due="Due today" amount="₹2,100" direction="PAY" compact />
              <MockRow title="Home Rent" meta={["Rent", "Landlord"]} due="Due in 2 days" amount="₹25,000" direction="PAY" compact />
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <span className="grid size-5 place-items-center rounded-md bg-receive text-white">
                <ArrowIn width={11} height={11} />
              </span>
              To receive
            </div>
            <div className="space-y-2">
              <MockRow title="Freelance project" meta={["Freelance", "Studio Kite"]} due="4 days overdue" amount="₹15,000" direction="RECEIVE" overdue compact />
              <MockRow title="Rent from Rahul" meta={["Rent Received"]} due="Due tomorrow" amount="₹18,000" direction="RECEIVE" compact />
              <MockRow title="Salary" meta={["Salary", "Employer"]} due="Due Nov 1" amount="₹80,000" direction="RECEIVE" compact />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
