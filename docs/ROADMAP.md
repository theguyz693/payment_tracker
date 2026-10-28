# Payment Tracker → Personal Finance Command Centre

Impact assessment, architecture proposal and phased roadmap.
Written 2026-10-28, after inspecting the codebase. Baseline: 15/15 tests pass and `tsc --noEmit` is clean.

---

## 1. What exists today (and what it means for the expansion)

| Area | Current state | Impact |
| --- | --- | --- |
| Data | One `transactions` collection. Each doc is one item (one-time or recurring) with an **embedded `history`** of settlements. Money is integer paise. | Good foundation. Settling is one atomic single-document update, guarded by `dueDate`, so double-clicks are no-ops. New features should copy this pattern. |
| History entries | They have **no stable id**: settlement ids are `${txId}-${arrayIndex}`. The recorded amount is always the item's current amount. | Receipts, ledger drill-down and CSV export need stable ids, so add `entryId` (with a lazy migration). There's no way to record a different amount actually paid, so add an optional actual-amount field. |
| Recurrence | Pure, anchor-based (`src/lib/recurrence.ts`). It handles month-end clamping and is well tested. | Keep the semantics. Add pause/resume and amount-change history *around* it, not inside it. |
| Status | OVERDUE is derived from the date, never stored. "Today" comes from the user's timezone cookie. | Keep this. All new "due/overdue" logic reuses `effectiveStatus` and `getToday()`. |
| Summaries | `src/lib/summary.ts` has pure functions: dashboard totals for this month only, plus a monthly summary. | Generalise to an arbitrary **period** (this month, last month, 3 months, YTD, custom), then build analytics on top. |
| Auth / isolation | `requireUser()` runs on every page and action. Every repository query filters on `userId`. | Every new collection gets a repository module with the same rule, plus `{ userId: 1, … }` indexes. |
| Categories | Fixed list in `types.ts`. It already contains `PAY:EMI / Loan`. | EMIs can link to an existing recurring item instead of creating a parallel schedule. |
| Data loading | `loadUserData` loads every item. That's fine at personal scale. | The unified ledger needs pagination (cursor on `settledOn` + id). |
| Charts | None, and no chart library is installed. | Add **Recharts** (SVG, React 19 compatible) and wrap it in themed chart components that use the existing tokens. |
| Design system | Tokens in `globals.css`: pay = indigo, receive = teal, overdue = crimson, pending = amber. Light and dark themes. | Extend with gain/loss/investment/goal tokens. Don't replace anything. |
| Repo hygiene | **Not a git repository.** There is no `public/` folder. There's a stale "Prisma" comment in `types.ts`. | Initialise git before any large change so each phase is reviewable and revertible. |
| Receipt animation | It's a React component (pasted in chat, saved to `docs/reference/receipt-printer.tsx.txt`). It needs `motion` and `@phosphor-icons/react`, a `cn` helper, `grayscale-*` tokens and two texture SVGs. **None of these are in the project.** | Port it: map `grayscale-*` to app tokens, add a tiny `cn`, and recreate the textures as inline SVG/CSS. The motion logic stays as written. |

---

## 2. Financial definitions (the consistency contract)

These rules are encoded in pure functions in `src/lib/` and unit-tested:

- **Cash flow (actual):** money that moved. That's settlement history by `settledOn`. Incoming is RECEIVE settlements; outgoing is PAY settlements.
- **Spending:** outgoing cash flow **excluding** investment contributions and transfers into savings goals. Those are reallocations of your own money, not consumption.
- **Outstanding obligations:** open (PENDING) items. Payables are what I owe; receivables are what's owed to me. **A receivable is never counted as cash received.**
- **Scheduled:** future occurrences of recurring items, SIP instalments and EMI instalments. They're shown as *expected*, never as actuals.
- **Projection:** anything computed from assumptions (forecast balance, goal completion date, hypothetical interest). It's always labelled.
- **Goal allocations:** ledger entries (contribution/withdrawal). They're earmarked from the user's cash, so they're **not** extra money. "Unallocated cash" is shown only when a starting balance exists.
- **Assets / net worth:** shown **only** when the user has supplied a cash balance (with an "as of" date). Net worth = cash + investment valuation − outstanding loan principal. Receivables are listed separately and are not added by default.
- **Returns:** simple return = (value − net invested) / net invested, labelled "absolute return". **XIRR** (money-weighted) is the annualised figure, with an explanation. A simple % is never presented as annualised.

---

## 3. Architecture proposal

### New collections (all carry `userId` and are indexed `{ userId: 1, … }`)
| Collection | Purpose | Integrity mechanism |
| --- | --- | --- |
| `userSettings` | Starting cash balance plus as-of date, and preferences | Single doc per user (unique `userId`) |
| `goals` | Savings goals, with **embedded `entries`** (contributions/withdrawals) and an optional linked recurring item | Atomic `$push` guarded by `entries.requestId $ne` (idempotent). Balance = sum of entries, never overwritten. |
| `loans` | Loan terms, embedded prepayments, and `linkedTransactionId` pointing to the EMI's recurring item | EMI payment history stays in the linked item, so there's **no duplicate obligations** |
| `holdings` | Instrument (MF/SIP, stock, ETF, gold, other), identifiers (AMFI scheme code, exchange symbol), SIP plan (amount, frequency, anchor, paused/stopped) | One doc per instrument per user |
| `investmentTxns` | BUY / SELL / SIP_CONTRIBUTION / FEE / DIVIDEND lots | Unique index `{ userId, requestId }` makes resubmits no-ops |
| `prices` | Cached market prices `{ key, price, asOf, source, fetchedAt }` (global), plus per-user manual prices | TTL on cache freshness; manual prices are user-scoped |

### Changes to `transactions` (backward compatible, no data deleted)
- `history[].entryId` is an ObjectId. Existing entries get it via an idempotent startup migration, and readers fall back to the index if it's missing.
- `history[].actualAmountPaise?` is optional. It defaults to the scheduled amount.
- `pausedAt` / `pausedFrom` support pause/resume. While paused, the item is excluded from forecasts and isn't overdue.
- `amountChanges[]` holds `{ from, to, effectiveFrom, at }` for price-change history. It's written on edit when the amount changes.
- `kind?` (`"BILL" | "SUBSCRIPTION" | "EMI" | "SIP"`) and `linkId?` link an item to a loan/holding/goal.

### Precision
- Money is **integer paise**, everywhere it's stored.
- Prices/NAVs are integer **1/10,000 rupee** (`price4`), and quantities (units, shares, grams) are integer **micro-units** (1e-6). Products are computed with `BigInt` and rounded **half-up to the paise** once, at the end. This is centralised in `src/lib/decimal.ts`.
- Rates (interest, returns) are stored in basis points. Display uses 2 dp.

### Market data (verified in the investments phase, before writing code)
| Asset | Likely source | Notes |
| --- | --- | --- |
| Indian MF NAVs | **AMFI**'s official daily NAV file | Free and official. NAVs are published **once per day**, so "real time" doesn't exist for MFs. |
| Indian stocks/ETFs | No free official NSE/BSE API. Options: a broker API (e.g. Kite Connect / Upstox, paid, tied to your broker) or a freemium vendor with delayed data | **Your budget decision.** Scraping NSE is against its terms, so it's excluded. |
| International stocks | Freemium vendors (Alpha Vantage, Twelve Data, Finnhub) | Rate-limited free tiers, usually delayed. |
| Gold (INR) | No free official real-time feed. Freemium metals APIs, or manual entry. | **Manual price by default.** Valuation applies purity and an optional sell spread. |

Every price shows its source, as-of time and a "stale" badge. Manual entry is always available. Nothing is ever faked as live.

### Navigation
Overview · Transactions (ledger) · Calendar · Goals · Loans · Investments · Analytics · Settings.
On desktop this is a left sidebar (the current top bar won't fit 8 items). On mobile it's a bottom bar with 4 items plus "More".
The existing `/dashboard`, `/transactions` and `/summary` keep working: `/summary` folds into Analytics with a redirect.

---

## 4. Phased roadmap (recommended order)

The brief's order is kept, except **Loans/Calendar move ahead of Investments**. They build directly on the existing recurrence system, need no external decisions, and the forecast they produce feeds the dashboard. Investments need provider/budget decisions and are the largest data-model addition, so they go later with the core already stable.

| Phase | Scope | Key files |
| --- | --- | --- |
| **0. Safety net** (small) | git init + baseline commit; `history.entryId` migration; `userSettings`; idempotency helper; `decimal.ts`; Recharts + chart wrappers; sidebar navigation shell; remove stale comment | `models.ts`, `repository.ts`, new `src/server/migrations.ts`, `AppHeader.tsx` → `AppNav.tsx`, `globals.css` |
| **1. Financial foundation** | Period selector; generalised period summaries; dashboard metrics (owed/owing, due week/month, overdue both ways, in vs out, net, planned 30/90/365, recurring commitments); analytics charts (income vs expense, net by month, category breakdown, upcoming obligations, 12-month recurring); drill-down links into filtered transactions; **Savings Goals** (ledger, projections, calculator); recurring improvements (pause/resume, upcoming previews, monthly/annual cost, amount-change history) | `lib/summary.ts` → `lib/period.ts`, `lib/analytics.ts`, `lib/goals.ts`; `server/goals-repo.ts`; `app/(app)/{overview,analytics,goals}` |
| **2. Loans & planning** | EMI calculator; amortisation; loans linked to EMI recurring items; prepayment/rate/tenure comparison; **Financial Calendar** (month grid + agenda); **cash-flow forecast** 30/90/365 with optional projected balance and "tight month" flags; in-app reminders | `lib/emi.ts`, `lib/forecast.ts`, `server/loans-repo.ts`, `app/(app)/{loans,calendar}` |
| **3. Investments** | Provider review, then holdings + lots; MF/SIP (scheduled vs actual contributions, pause/stop); stocks/ETFs (FIFO lots, partial sales, realised/unrealised); gold (purity, costs, spread); portfolio totals, allocation, XIRR; price cache + manual prices; contributions over time | `lib/portfolio.ts`, `lib/xirr.ts`, `server/investments-repo.ts`, `server/prices/*`, `app/(app)/investments` |
| **4. Receipts** | Port the ReceiptPrinter component; receipt for a real settlement (receipt no. from `entryId`) or a clearly watermarked **sample** bill; print stylesheet (and Save as PDF); optional PNG download | `components/receipt/*`, `lib/receipt.ts`, `app/(app)/receipts` |
| **5. Polish & ledger** | Unified paginated ledger across settlements, goal entries and investment txns; filters/search/sort; CSV export; monthly/annual comparisons; responsive and accessibility pass; empty/error states; landing-page prep | `app/(app)/transactions`, `lib/ledger.ts`, `app/api/export/route.ts` |

Each phase ends with: tests (existing + new), `npm run typecheck`, `npm run lint`, `npm run build`, a manual check of critical flows in the browser, a README update, and a commit.

### Tests added per phase
Recurrence + pause + duplicate prevention (P0/P1) · period totals and cash-flow definitions (P1) · goal projections and required-monthly (P1) · EMI/amortisation/prepayment (P2) · forecast (P2) · FIFO lots, partial sales, realised/unrealised, XIRR, rounding (P3) · receipt formatting (P4) · repository user isolation using an in-memory MongoDB (`mongodb-memory-server`, dev-only) (P0 onwards).

---

## 5. Known risks / limitations
- **No multi-document transactions are assumed**, because a local standalone `mongod` doesn't support them. All financial writes are single-document atomic updates or are made idempotent with `requestId`.
- Historical balances/net worth can't be reconstructed before the user supplies a starting balance. Charts start at the earliest trustworthy point.
- The two README "known issues" (a save hanging on a Mongo stand-in, and a filter click after typing) will be re-checked during Phase 1, since both pages get reworked.
