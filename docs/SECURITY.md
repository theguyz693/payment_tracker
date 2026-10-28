# Security

Audit date: 2026-10-28. This records what protects the app, what was changed, the remaining risks, and the settings that live outside the code. It isn't a guarantee: no app is completely secure.

## 1. How the app is protected

| Area | Protection | Where |
| --- | --- | --- |
| Authentication | Better Auth email/password. Passwords are hashed with scrypt (salted) and never read by app code. | `src/server/auth.ts` |
| Sessions | httpOnly, `SameSite=Lax` cookie; `Secure` + `__Secure-` prefix on HTTPS. 30-day expiry, extended daily. **No cookie cache**: every request checks the session in the database, so sign-out, "sign out other devices", password change and account deletion take effect immediately. Session tokens are stripped from JSON responses (they live only in the cookie). | `auth.ts` |
| Login rate limiting | 10 sign-in attempts/minute and 10 sign-ups/10 minutes per IP; also password change and account deletion. Stored in MongoDB, so it holds across Vercel instances. Client IP comes from `x-forwarded-for`, which Vercel overwrites, so it can't be spoofed there. Active in production only. | `auth.ts` |
| Authorisation | Every page and server action calls `requireUser()`, which verifies the session against the database. The user id always comes from that session. Every repository query filters by `userId`, so another user's id simply matches nothing. | `src/server/session.ts`, `src/server/*repo*.ts` |
| Route gate | Middleware sends visitors without a session cookie to `/login` (a fast first check; the real check is above). API routes return 401 without a session. | `src/middleware.ts`, `src/app/api/*` |
| CSRF | Server actions: Next.js checks `Origin` against `Host`. Better Auth: checks `Origin` against `BETTER_AUTH_URL`. The cookie is `SameSite=Lax`. Export endpoints are read-only GETs. | built in |
| Input validation | Zod schemas on the server for every form. Amounts are integer paise, at most ₹10,000 crore, with at most 2 decimals, parsed without floating point. Dates must be real dates from 1900 to 2199. Text has length limits. Ids must be 24-hex ObjectIds. Enums only accept known values (checked with `Object.hasOwn`, so `__proto__` etc. can't match). | `src/lib/validation.ts`, `src/lib/finance-validation.ts`, `src/lib/money.ts` |
| Duplicate processing | Settling is one atomic update guarded by the expected due date. Creates carry a `requestId` with a unique index. Goal/loan ledgers use a guarded `$push`. One recorded SIP per date (unique index). Withdrawals re-check the balance inside the update. | repositories |
| XSS | React escapes all output. The only inline script is a static theme snippet with a CSP nonce. | `src/app/layout.tsx` |
| Content Security Policy | Per-request nonce, `'strict-dynamic'`, no `unsafe-inline`/`unsafe-eval` scripts in production. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`. | `src/lib/csp.ts`, `src/middleware.ts` |
| Other headers | HSTS (2 years), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, permissions policy, `Cross-Origin-Opener-Policy: same-origin`. `X-Powered-By` is off. | `next.config.ts` |
| Redirects | `?next=` after login only allows same-site paths (rejects `//host`, `/\host`, schemes, whitespace and control characters). Form `returnTo` uses an allow-listed character set. | `src/lib/redirects.ts`, `src/server/form.ts` |
| CSV export | Fields are quoted, and cells starting with `= + - @` are prefixed so spreadsheets don't execute them. | `src/lib/ledger.ts` |
| Errors | Users see generic messages (or ones written for them). Details go to server logs only. | actions, `src/app/(app)/error.tsx` |
| Secrets | Only server code reads env vars. Nothing uses `NEXT_PUBLIC_`. `.env*` is git-ignored, and the git history contains no credentials. Market data is fetched server-side, so the Alpha Vantage key never reaches the browser. | — |
| Dev seed | Refuses `NODE_ENV=production`, and refuses any database not named `*_dev` / `*_test` unless named explicitly with `--allow-db=`. | `db/seed.ts`, `db/seed-guard.ts` |
| Privacy | Settings → Privacy & security has active sessions, sign out other devices, change password (signs out other devices), data export (JSON plus CSV per type), and account deletion. Deletion needs the password and removes all app data, then the user, credentials and sessions. | `src/app/(app)/settings/security` |

## 2. What this audit changed

1. **Seed script can no longer write to the real database.** Before, it only checked `NODE_ENV`, while `.env.local` points at production, so `--replace` could delete a real account's items.
2. **Content Security Policy added**, with a per-request nonce, plus `Cross-Origin-Opener-Policy`.
3. **Open redirect after login fixed.** `?next=/\evil.com` passed the old check.
4. **Immediate session revocation.** The 5-minute session cookie cache was turned off.
5. **Session tokens removed from JSON responses.** Better Auth returned them from sign-in, sign-up, get-session and list-sessions.
6. **Bounded inputs:**
   - Amounts are capped. Before, `99999999999999999999` was accepted and lost precision.
   - Dates must fall between 1900 and 2199.
   - Search strings are capped at 100 characters, and decimal strings at 40.
7. **Prototype-key bug fixed.** `?sort=__proto__` crashed the transactions page because `in` matched inherited object properties.
8. **Sign-out now checks the result.** Better Auth reports errors without throwing.
9. **Privacy & security page added**: sessions, password change, full data export and account deletion.
10. **Production now requires `BETTER_AUTH_SECRET`**, and warns when it's short.
11. **Explicit auth settings.** The IP header and cookie attributes are now set explicitly, and password-change and account-deletion attempts are rate-limited.

## 3. Tests

The tests run with `npm test` and don't touch a database:
- `src/server/ownership.test.ts` runs real repository code against two users' data in memory. User A can't read, update, settle, archive, restore, pause, resume, contribute to, link, sell from, re-price or delete anything of User B's, and B's data is byte-for-byte unchanged afterwards. Duplicate settles and contributions are recorded once, and paused items can't be settled.
- `src/server/isolation.test.ts`: every repository query and insert carries the caller's `userId`; malformed ids never reach the database.
- `src/server/actions-security.test.ts`: every server action refuses an unauthenticated caller before touching data. A forged `userId` field is ignored, and malformed or oversized inputs are rejected before the database.
- `src/server/export-route.test.ts`: exports return 401 without a session, 404 for unknown kinds, and only the session user's data regardless of the URL.
- `src/lib/security.test.ts` covers:
  - redirect safety
  - amount, date and text limits
  - the CSP contents
  - the seed guard
  - prototype keys
  - token stripping

Checked by hand against a production build (`next build && next start`, dev database):
- **Headers and CSP:** the CSP header is present, every inline script carries the nonce, and charts render.
- **Rate limiting:** 10 failed logins, then HTTP 429.
- **Export:** returns only the signed-in user's data.
- **Account deletion:**
  - It refuses a missing or wrong password.
  - Done through the form, it removes the user, the credential account and every app record.
  - It signs the user out and leaves the other user's data untouched.
- **Login hardening:**
  - `?next=/\evil.example` lands on `/dashboard`.
  - No session token appears in any auth JSON.
  - The session cookie isn't readable from JavaScript.

## 4. Manual configuration (outside the code)

**Vercel**
- Set `BETTER_AUTH_SECRET` (e.g. `openssl rand -base64 32`), `BETTER_AUTH_URL` (your `https://` domain), `MONGODB_URI` and `MONGODB_DB` for **Production only**. Use different values for Preview and Development (see Atlas below).
- HTTPS is automatic on Vercel. Keep `BETTER_AUTH_URL` on `https://` so cookies are marked `Secure`.
- Leave "Automatically expose System Environment Variables" as is. None of this app's secrets use `NEXT_PUBLIC_`.

**MongoDB Atlas**
- **Least privilege:** create a database user for the app with the built-in role `readWrite` on **`payment_tracker` only**, not `atlasAdmin` or "read and write to any database". Create a separate user (and ideally a separate free cluster) for development with `readWrite` on `payment_tracker_dev`. Never put the production credentials in `.env.local`.
- **Network:** Vercel uses changing IPs, so `0.0.0.0/0` is the practical setting on the free tier. Protection then rests on the strong, unique database password and TLS (on by default with `mongodb+srv`). On paid tiers, use Vercel Secure Compute or Atlas private endpoints to restrict access.
- **Monitoring:** turn on Atlas alerts for unusual connection counts and failed authentications.
- Rotate the database password if it was ever pasted anywhere public, and update `MONGODB_URI` on Vercel.

**Better Auth**
- Email verification and password reset need an email provider. Until one is set up, anyone can sign up with any email address (they can't receive mail, but the address is unverified). To enable: set `requireEmailVerification: true` and configure `sendVerificationEmail` / `sendResetPassword` in `src/server/auth.ts`.

## 5. Backup and restore (MongoDB Atlas)

**Free (M0) clusters have no automatic backups.** Use `mongodump`:
```bash
# Back up (run from a trusted machine; the URI is the production one, from your password manager)
mongodump --uri="$MONGODB_URI" --db=payment_tracker --gzip --archive=payment_tracker-$(date +%F).gz

# Restore into a SEPARATE database first and check it
mongorestore --uri="$MONGODB_URI" --gzip --archive=payment_tracker-YYYY-MM-DD.gz \
  --nsFrom='payment_tracker.*' --nsTo='payment_tracker_restore.*'
```
- Keep at least weekly dumps, encrypted, off the machine (the dump contains password hashes and all financial data).
- After checking `payment_tracker_restore`, either point `MONGODB_DB` at it, or restore over `payment_tracker` with `--drop` (destructive: only after a fresh dump).
- Test a restore every few months.

**Paid clusters (M10+)** have continuous cloud backups with point-in-time restore. Enable it under *Backup*, and restore to a new cluster or a new database rather than over the live one.

Users can also download their own data from Settings → Privacy & security.

## 6. Remaining risks and limits

- **No email verification or password reset.** A user who forgets their password can't recover the account without help from you, editing the database.
- **No two-factor authentication.** Better Auth's `twoFactor` plugin can add TOTP later.
- **Server actions aren't rate-limited**, apart from authentication. A signed-in user could spam their own data. Writes are bounded and per-user, but there's no per-user quota.
- **`style-src 'unsafe-inline'`** stays, because the chart and animation libraries set inline styles. Script injection is still blocked.
- **Market data:** AMFI and Alpha Vantage responses are parsed defensively, but they're third parties. A wrong upstream price would show as a wrong valuation, with its source and date displayed.
- **Atlas network access** is open to all IPs on the free tier (see above).
- **Dependencies** (`npm audit --omit=dev`, 2026-10-28):
  - **Next.js was upgraded 15.5.27 → 15.5.28** in this audit. That fixes a critical advisory (remote code execution in the image optimiser with SVGs, and a server-actions denial of service).
  - **Two items remain, both needing a major upgrade:**
    - **PostCSS bundled inside Next.js:** the advisories need attacker-controlled CSS, and this app only processes its own CSS at build time. The fix is Next 16.
    - **zod:** memory exhaustion when validating oversized collections. This app's schemas validate no arrays, sets or records, and server-action bodies are capped at 1 MB. Better Auth bundles its own copy. The fix is zod 4 (a breaking migration).
  - Re-run `npm audit` regularly and keep Next.js and Better Auth patched.
