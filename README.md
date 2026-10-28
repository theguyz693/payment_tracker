# Payment Tracker


A personal app for tracking what you need to pay and what you're owed. Each user signs in and sees only their own data.

## 1. Tech stack
- **Next.js 15** (App Router, server components, server actions), with TypeScript and Tailwind CSS v4
- **MongoDB** (Atlas), accessed with the official `mongodb` driver
- **Better Auth** for email and password login. It handles password hashing (scrypt), httpOnly session cookies, CSRF and origin checks, and rate limiting. Sessions are stored in MongoDB.
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

**Optional sample data (development only).** This adds demo items to one existing account and refuses to run when `NODE_ENV=production`:
```bash
npm run db:seed -- --email you@example.com            # add sample items
npm run db:seed -- --email you@example.com --replace  # replace that account's items
```

## 3. Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | Atlas connection string. Server-only, never sent to the browser. |
| `MONGODB_DB` | no | Database name. Default: `payment_tracker`. |
| `BETTER_AUTH_SECRET` | yes | Random secret of 32 or more characters. Generate one with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public URL of the app with no trailing slash, e.g. `https://your-app.vercel.app`. Locally: `http://localhost:3000`. |
| `DEFAULT_TIMEZONE` | no | Timezone used for "today" until the browser reports one. Default: `Asia/Kolkata`. |
| `MONGODB_TRANSACTIONS` | no | Set to `false` only when using a local standalone `mongod`. Leave it unset for Atlas. |

Never commit `.env.local`; `.gitignore` already excludes it.

## 4. MongoDB setup (Atlas)
1. At cloud.mongodb.com, create a free (M0) cluster.
2. Under **Database Access**, add a database user with a password.
3. Under **Network Access**, add `0.0.0.0/0`. Vercel's addresses change, so it has to accept connections from anywhere. Access is still protected by the database user's password.
4. Go to **Connect → Drivers** and copy the connection string into `MONGODB_URI`, replacing `<password>`.

The app creates its collections and indexes automatically on first use:
- **`transactions`:** one document per item. Each has a `userId` and an embedded `history` of paid and received occurrences.
- **`user`, `session`, `account`, `verification`, `rateLimit`:** managed by Better Auth. Password hashes live in `account` and are never read by app code.

## 5. Authentication
- `/signup` and `/login` use email and password, with a minimum of 8 characters. Sessions last 30 days and are extended once a day while you use the app.
- **Middleware** (`src/middleware.ts`) sends visitors without a session cookie to `/login`.
- **Real check:** every page and server action calls `requireUser()` (`src/server/session.ts`), which verifies the session against the database. The user id always comes from the session, never from the request.
- **Data access:** every query in `src/server/repository.ts` filters by `userId`.
- **Adding email verification or OTP later:** turn on `emailAndPassword.requireEmailVerification` with an email sender, or add Better Auth's `emailOTP` plugin in `src/server/auth.ts`. No data changes are needed.

## 6. Development commands
```bash
npm run dev        # dev server
npm run build      # production build
npm start          # run the production build
npm test           # unit tests (recurrence, overdue, totals, timezone)
npm run lint
npm run typecheck
```

## 7. Deploying to Vercel
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
src/app/(app)/        signed-in pages: dashboard, transactions (list/new/edit), summary
src/app/(auth)/       login, signup
src/app/api/auth/     Better Auth endpoints
src/components/       UI (TransactionItem, TransactionForm, FiltersBar, Toast, ConfirmDialog, …)
src/lib/              pure logic: dates, recurrence, status, summaries, filters, validation, money
src/server/           mongo client, models, auth, session, repository, server actions
db/seed.ts            development-only sample data
```

## Known issues to watch
- During local testing against a MongoDB stand-in, saving occasionally hung on "Saving…". This was not reproduced once rate-limit records were cleared, and has not been tested against Atlas.
- Once, clicking the Pay/Receive filter immediately after typing in search didn't apply.
