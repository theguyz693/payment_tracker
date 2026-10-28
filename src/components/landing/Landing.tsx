import Link from "next/link";
import { ArrowIn, ArrowOut, ArrowRight, BarChart, Home, Repeat, Search } from "../icons";
import { DashboardMockup, HeroVisual } from "./Mockups";
import { LandingNav } from "./LandingNav";
import { RevealObserver } from "./RevealObserver";

const d = (n: number) => ({ "--d": n }) as React.CSSProperties;

export function Landing() {
  return (
    <div className="landing relative overflow-x-clip">
      <LandingNav />
      <RevealObserver />
      <main>
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <Showcase />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function PrimaryCta({ children, large = false }: { children: React.ReactNode; large?: boolean }) {
  return (
    <Link
      href="/signup"
      className={`press group inline-flex items-center justify-center gap-2 rounded-full bg-ink font-semibold text-on-ink shadow-[0_10px_24px_-10px_rgb(20_28_43/0.55)] hover:-translate-y-px hover:shadow-[0_14px_30px_-10px_rgb(20_28_43/0.55)] ${
        large ? "h-14 px-8 text-base" : "h-12 px-6 text-[15px]"
      }`}
    >
      {children}
      <ArrowRight width={16} height={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

function SecondaryCta({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/login"
      className="press inline-flex h-12 items-center justify-center rounded-full border border-line-strong bg-surface/70 px-6 text-[15px] font-semibold text-ink backdrop-blur hover:border-ink-3 hover:bg-surface"
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section className="relative px-5 pt-32 pb-24 sm:px-8 sm:pt-40 sm:pb-44 lg:pb-48">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        <div className="max-w-xl">
          <h1 className="hero-in text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.04em] text-ink sm:text-6xl lg:text-[4.4rem]" style={d(0)}>
            Know where your money is going.
            <span className="mt-1 block text-ink-3">And where it&apos;s coming from.</span>
          </h1>
          <p className="hero-in mt-7 max-w-md text-lg leading-relaxed text-ink-2" style={d(1)}>
            Track payments, recurring expenses, bills, and money you&apos;re expecting — all in one beautifully simple place.
          </p>
          <div className="hero-in mt-10 flex flex-col gap-3 min-[420px]:flex-row" style={d(2)}>
            <PrimaryCta>Get Started</PrimaryCta>
            <SecondaryCta>Log In</SecondaryCta>
          </div>
          <p className="hero-in mt-6 text-sm text-ink-3" style={d(3)}>
            Free to use. Made for rupees, EMIs and rent.
          </p>
        </div>
        <div className="lg:pl-4">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Problem */

const CHAOS = [
  { label: "Electricity bill", amount: "₹2,100", dir: "PAY", x: "-38%", y: "-30px", r: "-7deg" },
  { label: "Car EMI", amount: "₹12,500", dir: "PAY", x: "34%", y: "-58px", r: "6deg" },
  { label: "Rent to pay", amount: "₹25,000", dir: "PAY", x: "-22%", y: "10px", r: "4deg" },
  { label: "Rent to collect", amount: "₹18,000", dir: "RECEIVE", x: "40%", y: "-6px", r: "-5deg" },
  { label: "Netflix", amount: "₹649", dir: "PAY", x: "-44%", y: "24px", r: "8deg" },
  { label: "Arjun owes you", amount: "₹3,000", dir: "RECEIVE", x: "26%", y: "40px", r: "-9deg" },
  { label: "You owe Priya", amount: "₹1,200", dir: "PAY", x: "-10%", y: "64px", r: "5deg" },
] as const;

function Problem() {
  return (
    <section className="border-y border-line bg-surface px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        <div>
          <h2 data-reveal className="text-4xl leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-5xl">
            Your financial life shouldn&apos;t live in five different places.
          </h2>
          <p data-reveal style={d(1)} className="mt-6 max-w-md text-lg leading-relaxed text-ink-2">
            Bills in your inbox. EMIs on a calendar. Rent to pay, rent to collect. Subscriptions you forgot about. Money people owe
            you, and money you owe them.
          </p>
          <p data-reveal style={d(2)} className="mt-4 max-w-md text-lg leading-relaxed text-ink">
            Payment Tracker puts all of it in one list, so nothing slips.
          </p>
        </div>

        <div data-reveal-group className="relative mx-auto w-full max-w-md">
          <div className="chaos-frame shadow-product absolute -inset-3 rounded-[24px] border border-line bg-canvas sm:-inset-5 sm:rounded-[26px]" />
          <div className="relative">
            <div className="chaos-frame mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-bold">Everything, in one place</span>
              <span className="text-xs text-ink-3">7 items</span>
            </div>
            <ul className="space-y-2">
              {CHAOS.map((c, i) => (
                <li
                  key={c.label}
                  className="chaos-chip relative flex items-center gap-3 rounded-xl border border-line bg-surface py-2.5 pr-4 pl-3.5 shadow-[0_2px_8px_-4px_rgb(20_28_43/0.15)]"
                  style={{ "--x": c.x, "--y": c.y, "--r": c.r, "--i": i } as React.CSSProperties}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                      c.dir === "PAY" ? "bg-pay-soft text-pay-strong" : "bg-receive-soft text-receive-strong"
                    }`}
                  >
                    {c.dir === "PAY" ? <ArrowOut width={13} height={13} /> : <ArrowIn width={13} height={13} />}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{c.label}</span>
                  <span className={`num text-sm font-bold ${c.dir === "PAY" ? "text-ink" : "text-receive-strong"}`}>
                    {c.dir === "RECEIVE" ? "+" : ""}
                    {c.amount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Features */

const FEATURES = [
  {
    title: "Payments",
    body: "Never lose track of what needs to be paid. Rent, EMIs, bills and one-off expenses, sorted by when they're due.",
    Icon: ArrowOut,
    tone: "pay",
  },
  {
    title: "Money to receive",
    body: "Know exactly what you're waiting for. Salary, rent from tenants, refunds and money friends owe you.",
    Icon: ArrowIn,
    tone: "receive",
  },
  {
    title: "Recurring",
    body: "Set it once. Mark this month's rent as paid and next month's shows up on its own, on the right date.",
    Icon: Repeat,
    tone: "neutral",
  },
  {
    title: "Dashboard",
    body: "Your financial picture at a glance: what's due today, this week, what's overdue, and what's coming in.",
    Icon: Home,
    tone: "neutral",
  },
  {
    title: "Expenses",
    body: "Understand where your money actually goes, with a simple monthly summary and a breakdown by category.",
    Icon: BarChart,
    tone: "neutral",
  },
  {
    title: "Organised",
    body: "Everything categorised, searchable and easy to find. Filter by status, category or date in a tap.",
    Icon: Search,
    tone: "neutral",
  },
] as const;

function Features() {
  return (
    <section id="features" className="px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 data-reveal className="text-4xl leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-5xl">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p data-reveal style={d(1)} className="mt-5 text-lg leading-relaxed text-ink-2">
            Built around one question: what do I need to pay, and what am I owed?
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, body, Icon, tone }, i) => (
            <div
              key={title}
              data-reveal
              style={d(i % 3)}
              className="group rounded-2xl border border-line bg-surface p-6 transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_18px_40px_-22px_rgb(20_28_43/0.35)] sm:p-7"
            >
              <span
                className={`grid size-11 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 ${
                  tone === "pay"
                    ? "bg-pay-soft text-pay-strong"
                    : tone === "receive"
                      ? "bg-receive-soft text-receive-strong"
                      : "bg-canvas text-ink"
                }`}
              >
                <Icon width={20} height={20} />
              </span>
              <h3 className="mt-6 text-lg font-bold tracking-tight">{title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- How it works */

const STEPS = [
  { title: "Add what matters", body: "Rent, EMIs, bills, salary, money someone owes you. Choose pay or receive, an amount and a date." },
  { title: "Track what's due", body: "Your dashboard shows what's due today, this week and what's overdue, without any digging." },
  { title: "Stay ahead of your money", body: "Mark things paid with one tap. Recurring items roll forward on their own, every month." },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-line bg-surface px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <h2 data-reveal className="max-w-2xl text-4xl leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-5xl">
          Three steps. That&apos;s it.
        </h2>
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} data-reveal style={d(i)} className="relative">
              <div className="flex items-center gap-4">
                <span className="num text-sm font-bold text-ink-3">0{i + 1}</span>
                <span className="h-px flex-1 bg-line-strong" aria-hidden />
              </div>
              <h3 className="mt-6 text-xl font-bold tracking-tight">{s.title}</h3>
              <p className="mt-2 max-w-xs leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Showcase */

function Showcase() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 data-reveal className="text-4xl leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-5xl">
            One look, and you know where you stand.
          </h2>
          <p data-reveal style={d(1)} className="mt-5 text-lg leading-relaxed text-ink-2">
            What you owe on the left, what you&apos;re owed on the right. Overdue items stand out, so they never get missed.
          </p>
        </div>
        <div data-reveal style={d(2)} className="relative mt-16">
          <div
            className="pointer-events-none absolute inset-x-[8%] -top-10 -bottom-10 -z-10 rounded-[60px] bg-[radial-gradient(50%_60%_at_50%_45%,var(--color-pay-soft),transparent_75%)]"
            aria-hidden
          />
          <DashboardMockup />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Final CTA */

function FinalCta() {
  return (
    <section className="px-5 pb-24 sm:px-8 sm:pb-32">
      <div
        data-reveal
        className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-ink px-6 py-20 text-center text-on-ink sm:px-12 sm:py-28"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(40%_60%_at_20%_0%,color-mix(in_srgb,var(--color-pay)_45%,transparent),transparent_70%),radial-gradient(40%_60%_at_85%_100%,color-mix(in_srgb,var(--color-receive)_40%,transparent),transparent_70%)]"
          aria-hidden
        />
        <div className="relative">
          <h2 className="text-5xl leading-[1] font-extrabold tracking-[-0.04em] sm:text-7xl">
            Your money.
            <span className="block opacity-60">One place.</span>
          </h2>
          <p className="mx-auto mt-7 max-w-md text-lg leading-relaxed opacity-75">
            Start keeping track of what you owe, what you&apos;re owed, and everything in between.
          </p>
          <Link
            href="/signup"
            className="press group mt-10 inline-flex h-14 items-center justify-center gap-2 rounded-full bg-on-ink px-8 text-base font-semibold text-ink shadow-[0_14px_30px_-12px_rgb(0_0_0/0.5)] hover:-translate-y-px"
          >
            Get Started — It&apos;s Free
            <ArrowRight width={16} height={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Footer */

function Footer() {
  const links = [
    { href: "/login", label: "Log in" },
    { href: "/signup", label: "Sign up" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
  ];
  return (
    <footer className="border-t border-line px-5 py-12 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-ink text-[13px] font-extrabold text-on-ink">
              ₹
            </span>
            Payment Tracker
          </div>
          <p className="mt-2 max-w-xs text-sm text-ink-3">What you owe, what you&apos;re owed, and when. All in one place.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-ink-2" aria-label="Footer">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
