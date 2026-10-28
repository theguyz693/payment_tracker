import Link from "next/link";
import { Hero } from "./hero/Hero";
import { InstrumentMark, RingsFallback } from "./hero/RingsFallback";
import { LandingNav } from "./LandingNav";
import { ProductPreview } from "./ProductPreview";
import { ReceiptShowcase } from "./ReceiptShowcase";
import { RevealObserver } from "./RevealObserver";
import { CalendarScene } from "./scenes/CalendarScene";
import { CashFlowScene } from "./scenes/CashFlowScene";
import { GoalScene } from "./scenes/GoalScene";
import { InvestScene } from "./scenes/InvestScene";
import { btnGhost, btnPaper, d, display } from "./styles";

// Public landing page, "The Instrument": an always-dark, art-directed page
// that sits apart from the app's own light/dark theme (tokens are re-scoped
// under .landing in globals.css). Every figure on it is an illustrative sample.

export function Landing() {
  return (
    <div className="landing relative overflow-x-clip">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <LandingNav />
      <RevealObserver />
      <main id="main">
        <Hero />
        <Product />
        <Receipt />
        <Features />
        <Security />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

function SectionHead({ title, children, id }: { title: React.ReactNode; children?: React.ReactNode; id?: string }) {
  return (
    <div className="max-w-3xl">
      <h2 id={id} data-reveal className={`${display} text-[clamp(2.3rem,5.4vw,4.6rem)]`}>
        {title}
      </h2>
      {children && (
        <p data-reveal style={d(2)} className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
          {children}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Product */

function Product() {
  return (
    <section id="product" aria-labelledby="product-title" className="relative px-5 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto max-w-[88rem]">
        <SectionHead id="product-title" title={<>The whole picture, <em className="text-ink-3">on one screen.</em></>}>
          Money going out, money coming in, what&apos;s overdue, what&apos;s invested and what you&apos;re saving for. Try it below.
        </SectionHead>
        <div data-reveal style={d(2)} className="mt-16 sm:mt-20">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Receipt */

function Receipt() {
  return (
    <section aria-labelledby="receipt-title" className="relative overflow-hidden border-y border-line bg-[#0d0d0e] px-5 py-28 sm:px-8 sm:py-40">
      <div className="receipt-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto grid max-w-[88rem] items-center gap-16 lg:grid-cols-[1fr_auto] lg:gap-24">
        <div>
          <SectionHead id="receipt-title" title={<>Settle it, and it <em className="text-brass">prints.</em></>}>
            Mark a payment as paid or received and Payment Tracker prints a record of it: amount, date, category, who it was
            with. Print it, save it as a PDF or download it.
          </SectionHead>
          <ul data-reveal style={d(3)} className="mt-10 grid max-w-lg gap-4 font-mono text-[13px] text-ink-3 sm:grid-cols-2">
            <li className="border-t border-line pt-3">A personal record for your own files.</li>
            <li className="border-t border-line pt-3">Not a bank, payment or tax receipt, and it says so.</li>
          </ul>
        </div>
        <ReceiptShowcase />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Features */

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="px-5 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto max-w-[88rem]">
        <SectionHead id="features-title" title={<>Four ways to see <br className="hidden sm:block" /> the same money.</>} />

        <article className="mt-24 sm:mt-32" aria-labelledby="f-flow">
          <SceneTitle id="f-flow" title="Where it went." body="Analytics trace a month from what came in to every place it went, by category, with the trend over time." />
          <div className="mt-12">
            <CashFlowScene />
          </div>
        </article>

        <article className="mt-32 sm:mt-44" aria-labelledby="f-cal">
          <SceneTitle
            id="f-cal"
           
            title="What's coming."
            body="Rent, EMIs, SIPs and bills on one calendar, with a forecast of your balance day by day. Pick a date."
          />
          <div className="mt-12">
            <CalendarScene />
          </div>
        </article>

        <article className="mt-32 sm:mt-44" aria-labelledby="f-goal">
          <SceneTitle
            id="f-goal"
           
            title="Fill it on purpose."
            body="Savings goals keep a ledger of every contribution and withdrawal, and tell you what it takes to finish on time. Try the buttons."
          />
          <div className="mt-14">
            <GoalScene />
          </div>
        </article>

        <article className="mt-32 sm:mt-44" aria-labelledby="f-inv">
          <SceneTitle
            id="f-inv"
           
            title="Contributions, then growth."
            body="Track mutual funds, SIPs, stocks, ETFs and gold. Fund NAVs come from AMFI's daily file; other prices are delayed quotes or ones you enter, each shown with its source and date."
          />
          <div className="mt-14">
            <InvestScene />
          </div>
        </article>
      </div>
    </section>
  );
}

function SceneTitle({ id, title, body }: { id: string; title: string; body: string }) {
  return (
    <div className="grid gap-4 border-t border-line pt-6 md:grid-cols-2 md:gap-8">
      <h3 id={id} data-reveal style={d(1)} className="font-display text-[clamp(1.8rem,3.4vw,2.75rem)] leading-tight font-semibold tracking-[-0.03em] text-ink">
        {title}
      </h3>
      <p data-reveal style={d(2)} className="max-w-md text-[17px] leading-relaxed text-ink-2">
        {body}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- Security */

// Only protections verified in this codebase (see docs/SECURITY.md).
const PROTECTIONS = [
  ["Passwords", "Hashed with salted scrypt by Better Auth. The app never stores or reads the password itself."],
  ["Sessions", "An httpOnly cookie, checked against the database on every request. Sign out other devices and it takes effect at once."],
  ["Your records only", "Every query is scoped to your account, and tests check that one account can't read or change another's."],
  ["Sign-in limits", "Sign-in attempts are rate-limited per address. Too many in a short time and they're refused."],
  ["In the browser", "A strict Content Security Policy: scripts run only with a fresh per-request nonce."],
  ["Leaving", "Export everything as JSON or CSV. Delete your account with your password, and every record goes with it."],
  ["Market prices", "Fetched by our server. Your holdings are never sent to a price provider."],
] as const;

function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className="border-t border-line bg-[#0d0d0e] px-5 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto grid max-w-[88rem] gap-16 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead id="security-title" title={<>Quiet about your data. <em className="text-ink-3">Strict about access.</em></>}>
            What protects your account, stated plainly. No system is perfectly secure; this is what we actually do.
          </SectionHead>
          <p data-reveal style={d(3)} className="mt-6 text-sm text-ink-3">
            Details in the{" "}
            <Link href="/privacy" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-brass">
              privacy policy
            </Link>
            .
          </p>
        </div>
        <dl className="border-t border-line">
          {PROTECTIONS.map(([k, v], i) => (
            <div key={k} data-reveal style={d(i % 3)} className="grid gap-2 border-b border-line py-6 sm:grid-cols-[12rem_1fr] sm:gap-8">
              <dt className="flex items-baseline gap-3 font-mono text-[12px] tracking-[0.12em] text-brass uppercase">
                <span className="text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                {k}
              </dt>
              <dd className="text-[16px] leading-relaxed text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Closing */

function Closing() {
  return (
    <section aria-labelledby="closing-title" className="relative overflow-hidden px-5 py-32 text-center sm:px-8 sm:py-48">
      <div className="closing-rings pointer-events-none absolute inset-0 flex items-center justify-center opacity-20 sm:opacity-35" aria-hidden>
        <RingsFallback className="h-[85%] w-auto max-w-none sm:h-[120%]" />
      </div>
      <div className="closing-veil pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-4xl">
        <h2 id="closing-title" data-reveal style={d(1)} className={`${display} text-[clamp(2.8rem,7.5vw,7rem)]`}>
          Bring your money <em className="text-brass">into focus.</em>
        </h2>
        <p data-reveal style={d(2)} className="mx-auto mt-8 max-w-md text-lg leading-relaxed text-ink-2">
          Free to use. Built for rupees, rent and EMIs. Set up in a few minutes.
        </p>
        <div data-reveal style={d(3)} className="mt-11 flex flex-col items-center justify-center gap-3 min-[420px]:flex-row">
          <Link href="/signup" className={`${btnPaper} h-14 px-8 text-base`}>
            Create your account <span aria-hidden>→</span>
          </Link>
          <Link href="/login" className={`${btnGhost} h-14 px-8 text-base`}>
            I have an account
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
    <footer className="border-t border-line px-5 py-14 sm:px-8">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/" className="flex items-center gap-3 text-ink">
            <InstrumentMark className="size-8" />
            <span className="text-xl font-semibold tracking-[-0.02em]">Payment Tracker</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-3">
            What you owe, what you&apos;re owed, and everything in between. Figures on this page are illustrative samples.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-ink-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="underline-offset-4 transition-colors hover:text-ink hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
