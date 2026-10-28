# Payment Tracker

A personal finance command centre: payments and money you're owed, cash flow, savings goals, loans and EMIs, investments, a financial calendar and forecast. Each user signs in and sees only their own data.

## What's in the app
| Section | What it does |
| --- | --- |
| **Overview** (`/dashboard`) | What you owe and are owed, due this week/month, overdue, cash flow for a chosen period, planned spending (30/90/365 days), recurring commitments, goals, investments, net worth (once a cash balance is set). Every figure links to the records behind it. |
| **Transactions** | Items (one-time and recurring), with pause/resume, upcoming dates, monthly/annual cost and price-change history. **History** is the unified ledger of everything that actually happened, with filters, pagination and CSV export. |
| **Calendar** | Month grid and agenda of bills, EMIs, expected money, SIPs and goal plans, plus a 30/90/365-day cash-flow forecast with tight-month warnings. |
| **Savings Goals** | Goals with a contribution/withdrawal ledger, required monthly saving, projected completion, status, and a what-if calculator. |
| **Loans & EMI** | EMI calculator and scenario comparison; tracked loans with amortisation, prepayments and outstanding principal, linked to one recurring EMI payment. |
| **Investments** | Mutual funds/SIPs (daily AMFI NAVs), stocks/ETFs, gold. FIFO lots, partial sales, realised/unrealised gains, XIRR. |
| **Analytics** | Income vs expenses, net cash flow, category breakdown and trends, largest expenses, year-to-date comparison, allocation, cash trend. |
| **Receipts** | Receipt-printer animation for any recorded payment, and a clearly labelled SAMPLE bill generator. |
| **Settings** | Starting cash balance (powers net worth and the projected balance). |

How each number is defined (cash flow vs outstanding vs projections, what counts as spending, how returns are calculated) is written down in [docs/ROADMAP.md](docs/ROADMAP.md#2-financial-definitions-the-consistency-contract).

## 1. Tech stack
- **Next.js 15** (App Router, server components, server actions), with TypeScript and Tailwind CSS v4
- **MongoDB** (Atlas), accessed with the official `mongodb` driver
- **Better Auth** for email and password login. It handles password hashing (scrypt), httpOnly session cookies, CSRF and origin checks, and rate limiting. Sessions are stored in MongoDB.
- **Recharts** for charts, **motion** + **Phosphor icons** for the receipt printer
- **Vitest** for unit tests
- **Hosting:** Vercel

## 2. Local setup
Requirements: **Node.js 20.12 or newer**.

```bash
npm install
cp .env.example .env.local     # then fill in the values (see below)
npm run dev                    # http://localhost:3000
```
Open `/signup` and create an account.

**Optional sample data (development only).** This adds demo items to one existing account. It refuses to run when `NODE_ENV=production`, and refuses any database whose name doesn't end in `_dev` or `_test`, so it can't touch real data:
```bash
MONGODB_DB=payment_tracker_dev npm run db:seed -- --email you@example.com            # add sample items
MONGODB_DB=payment_tracker_dev npm run db:seed -- --email you@example.com --replace  # replace that account's items
```
Sign up in the app against the same database first (e.g. put `MONGODB_DB="payment_tracker_dev"` in `.env.development.local`).

## 3. Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | Atlas connection string. Server-only, never sent to the browser. |
| `MONGODB_DB` | no | Database name. Default: `payment_tracker`. |
| `BETTER_AUTH_SECRET` | yes | Random secret of 32 or more characters. Generate one with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public URL of the app with no trailing slash, e.g. `https://your-app.vercel.app`. Locally: `http://localhost:3000`. |
| `DEFAULT_TIMEZONE` | no | Timezone used for "today" until the browser reports one. Default: `Asia/Kolkata`. |
| `MONGODB_TRANSACTIONS` | no | Set to `false` only when using a local standalone `mongod`. Leave it unset for Atlas. |
| `ALPHA_VANTAGE_API_KEY` | no | Delayed stock/ETF quotes (see *Market data*). Without it, stock prices are entered manually. |

Never commit `.env.local`; `.gitignore` already excludes it.

## 4. MongoDB setup (Atlas)
1. At cloud.mongodb.com, create a free (M0) cluster.
2. Under **Database Access**, add a database user with a password.
3. Under **Network Access**, add `0.0.0.0/0`. Vercel's addresses change, so it has to accept connections from anywhere. Access is still protected by the database user's password.
4. Go to **Connect → Drivers** and copy the connection string into `MONGODB_URI`, replacing `<password>`.

The app creates its collections and indexes automatically on first use:
- **`transactions`:** one document per item. Each has a `userId` and an embedded `history` of paid and received occurrences (each with a stable `entryId`; older entries get one automatically the first time the account loads).
- **`userSettings`, `goals`, `loans`, `holdings`, `investmentTxns`:** the planning and investment features. All carry `userId`. Goal contributions and loan prepayments are append-only ledgers inside their document.
- **`prices`, `priceHistory`:** cached market prices (shared, not user data).
- **`user`, `session`, `account`, `verification`, `rateLimit`:** managed by Better Auth. Password hashes live in `account` and are never read by app code.

## 5. Authentication
- `/signup` and `/login` use email and password, with a minimum of 8 characters. Sessions last 30 days and are extended once a day while you use the app.
- **Middleware** (`src/middleware.ts`) sends visitors without a session cookie to `/login`.
- **Real check:** every page and server action calls `requireUser()` (`src/server/session.ts`), which verifies the session against the database. The user id always comes from the session, never from the request.
- **Data access:** every query in `src/server/repository.ts` (and the other repositories) filters by `userId`.
- **Privacy & security** (Settings): active sessions, sign out other devices, change password, data export, account deletion.
- Full audit, protections, manual Atlas/Vercel settings and **backup/restore**: [docs/SECURITY.md](docs/SECURITY.md).
- **Adding email verification or OTP later:** turn on `emailAndPassword.requireEmailVerification` with an email sender, or add Better Auth's `emailOTP` plugin in `src/server/auth.ts`. No data changes are needed.

## 6. Market data
| Asset | Source | Notes |
| --- | --- | --- |
| Indian mutual funds | [AMFI daily NAV file](https://portal.amfiindia.com/spages/NAVAll.txt) | Free, official, no key. NAVs are published once per business day, so the value is "as of" the last NAV date. Cached for 6 hours. |
| Stocks / ETFs | [Alpha Vantage](https://www.alphavantage.co/documentation/) `GLOBAL_QUOTE` (optional) | Needs `ALPHA_VANTAGE_API_KEY`. Delayed, and the free tier is heavily rate-limited, so quotes are cached for 6 hours and at most 3 are fetched per page load. Indian stocks use `.BSE` symbols, e.g. `RELIANCE.BSE`. |
| Gold | Manual | There's no free, official, real-time INR gold feed. Enter the 24K price per gram; valuations apply purity and your expected sell deduction. |

Every price shows its source and as-of date, and is flagged "stale" after 5 days. Manual prices are always available; the more recent of the manual and market price is used. Prices are never invented: an unpriced holding shows "No price" and is left out of totals.

## 7. Development commands
```bash
npm run dev        # dev server
npm run build      # production build
npm start          # run the production build
npm test           # unit tests (recurrence, totals, goals, EMI, portfolio, XIRR, forecast, ledger, receipts, user isolation)
npm run lint
npm run typecheck
```

## 8. Deploying to Vercel
1. Push the project to GitHub. Check that `.env.local` is **not** committed.
2. At vercel.com, choose **Add New → Project** and import the repo. The framework is detected as Next.js; keep the default build settings.
3. Under **Environment Variables**, add `MONGODB_URI`, `MONGODB_DB`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` for the Production environment.
   - For `BETTER_AUTH_URL`, use your production domain.
   - If you don't know the domain yet, deploy once, copy the URL, set the variable, then redeploy.
4. Deploy, then check:
   - signing up works
   - adding an item works
   - refreshing `/transactions` keeps you logged in
   - logging out and back in shows the same data
5. Optional: if you add a custom domain later, update `BETTER_AUTH_URL` to match and redeploy.

## Project layout
```
src/app/(app)/        signed-in pages: dashboard (overview), transactions (+history), calendar,
                      goals, loans, investments, analytics, summary, receipts, settings
src/app/(auth)/       login, signup
src/app/api/          Better Auth endpoints, CSV export
src/components/       UI (AppNav, charts, ui primitives, forms, receipt/, …)
src/lib/              pure logic: dates, recurrence, analytics, goals, emi, forecast, portfolio,
                      xirr, decimal, ledger, receipt, validation, money
src/server/           mongo client, models, repositories, loaders, prices, server actions
db/seed.ts            development-only sample data
docs/ROADMAP.md       architecture, financial definitions and roadmap
```

## Limitations
- **Estimates, not statements.** Cash balance, net worth, loan schedules and forecasts are calculated from what you record here. Loan schedules assume a fixed rate, payment on the due date and tenure-reducing prepayments.
- **No bank or broker sync.** Everything is entered by you; investment prices are the only external data.
- **Returns.** Absolute return is not annualised. XIRR is shown once the first investment is a year old. Time-weighted returns and historical portfolio valuations aren't calculated (there's no valuation history before prices start being cached).
- **Net worth history** can't be reconstructed before the cash-balance date you enter, so the cash trend starts there.
- **Receipts** download as print/PDF (via the browser) or plain text; there's no PNG export.

## Known issues to watch
- During local testing against a MongoDB stand-in, saving occasionally hung on "Saving…". This was not reproduced once rate-limit records were cleared, and has not been tested against Atlas.
- Once, clicking the Pay/Receive filter immediately after typing in search didn't apply.
