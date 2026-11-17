# Reliability, API protection and the Financial Integrations Hub

This document covers three additions to Payment Tracker:

- **IdemPay**: the reliability layer (idempotency, event processing, retries, recovery).
- **GateKeeper**: the protection layer (authentication, rate limits, validation, structured logs).
- **Financial Integrations Hub**: the user-facing feature that exercises both, with **simulated** providers.

> **Everything in the hub is simulated.** There are no real Google Pay, PhonePe, Groww, UPI, bank or brokerage connections. No real money moves and no banking credentials are stored. The providers are demo simulators that send provider-shaped, signed payloads into the same pipeline a real, approved integration would use.

## Architecture

```
                     ┌──────────────────────────── Next.js app (Vercel) ───────────────────────────┐
 Browser (signed in) │                                                                              │
  hub forms ────────►│ server actions ──► gate(): requireUser + rate limit + request id             │
                     │   │ simulators build a provider payload and sign it (HMAC)                   │
                     │   ▼                                                                          │
 External caller ───►│ POST /api/integrations/webhook/[provider]   (IP rate limit, 16 KB cap)       │
  (signed webhook)   │   │                                                                          │
                     │   ▼                                                                          │
                     │ receiveDelivery()                                                            │
                     │   1 known provider          2 HMAC signature + 5-minute timestamp window     │
                     │   3 adapter.normalize (Zod) 4 demo connection → owning user (session must match)│
                     │   5 insert integrationEvents  ── unique (userId, provider, externalEventId)  │
                     │        └─ duplicate → duplicateCount++, audit, return the stored result      │
                     │   ▼                                                                          │
                     │ processEvent()                                                               │
                     │   6 claim: atomic status → PROCESSING + 30 s lease (stale leases taken over) │
                     │   7 ONE MongoDB transaction:                                                 │
                     │        handler (existing repositories) + event PROCESSED + auditLog          │
                     │   8 failure: business rule → FAILED; transient → RETRY_PENDING (backoff)     │
                     │                                                                              │
 Vercel Cron ───────►│ GET /api/cron/integrations (CRON_SECRET): recover stuck → process retries    │
                     └──────────────────────────────────────────────────────────────────────────────┘
                                   │ existing collections stay the sources of truth
                                   ▼
          transactions (+history)   investmentTxns/holdings   paymentRequests   mandates/mandateAttempts
```

Provider-specific code lives only in `src/lib/integrations/adapters.ts`. Adding a real provider later means adding an adapter (and its authentication), without changing the processor.

## Phase 1 fixes to existing code

| Problem found | Fix | Where |
| --- | --- | --- |
| The transaction form had no idempotency key, so a retried submit created duplicates. | The form sends a client key. `withIdempotency` stores `(user, scope, key)` with a payload hash. The insert and the COMPLETED marker commit in one transaction. | `TransactionForm.tsx`, `actions.ts`, `idempotency.ts` |
| A stale edit could write an old `dueDate` back after a settlement, reopening a paid occurrence. | The form sends a `version` token. The update is also conditioned on the `updatedAt`, `dueDate` and `status` it read, and anything else is refused as a `StaleWriteError`. | `repository.ts` (`updateTransaction`) |
| "Mark paid" reported success even when nothing was updated. | `settleOccurrence` returns `settled`, `already_settled`, `archived`, `paused`, `changed` or `not_found`, and the UI shows each honestly. | `repository.ts`, `actions.ts`, `ItemActions.tsx` |
| Concurrent sells could both pass validation (oversell). | Trade writes run in a transaction that bumps `holdings.txnSeq`. Concurrent writers conflict, and the retry re-validates against FIFO. Deletes are serialised the same way. | `investments-repo.ts` |
| Loan, EMI item and link were three separate writes. | All three commit in one transaction, and a retry repairs a loan missing its EMI item. | `finance-actions.ts`, `finance-repo.ts` |

## IdemPay

### Idempotency (`src/server/idempotency.ts`)

| Case | Behaviour |
| --- | --- |
| New key | Claim the record (unique index), run the operation, store the result. |
| Same key, same payload, completed | Return the stored result (`replayed: true`). |
| Same key, different payload | `IdempotencyConflictError`. |
| Same key, still running | Wait up to about 2.4 s, then `InProgressError`. |
| Previous run failed | Run again. A failed run committed nothing, because its writes were in the rolled-back transaction. |
| Claim older than its 30 s lease | Taken over (the worker died). |
| Expiry | TTL index, 24 h after completion. |

It is used for transaction creation (scope `transaction.create`) and payment-request decisions (scope `payment_request.decide`). Events use their own natural key, described next.

### Event processing (`src/server/integrations/pipeline.ts`)

- **Statuses:** `RECEIVED → PROCESSING → PROCESSED`. Failures go to `FAILED` or `RETRY_PENDING`.
  - Duplicate deliveries are counted on the original event (`duplicateCount`) instead of creating new documents.
  - `DUPLICATE` exists as a status for filtering, but duplicates never get their own record.
- **Effectively-once side effects** rely on all of the following, not on "the event has a unique id":
  - a unique `(userId, provider, externalEventId)` index;
  - a lease-guarded claim, so only one worker processes an event;
  - the handler's writes, the PROCESSED marker and the audit entry commit in **one transaction**, guarded by the lease, so a worker that lost its lease can't commit;
  - natural keys inside the handlers:
    - `requestId: evt:<eventId>` on transactions and trades;
    - unique attempt numbers;
    - one SUCCESS per mandate occurrence (partial unique index);
    - unique external request ids.
- **Crash recovery:** an event stuck in `PROCESSING` past its lease is moved back to `RETRY_PENDING` by `recoverStuckEvents`. Its transaction never committed, so nothing was applied. Recovery runs:
  - on the cron route;
  - from the console's "Run retry worker" button;
  - before a manual retry.
- **Retries:** exponential backoff of 15 s, 30 s, 1 m, 2 m and so on, capped at 15 m, with at most 5 attempts. Business-rule failures (oversell, paused mandate, unknown payment reference) are `FAILED` immediately and never retried on their own. The user can still retry them from the console.
- **Payload conflicts:** the same event id with different financial content is rejected (`409 PAYLOAD_CONFLICT`). Delivery metadata such as timestamps is excluded from the fingerprint.

### What each event does (`handlers.ts`)

| Event | Effect, always on existing collections |
| --- | --- |
| `payment.debit` / `payment.credit`: SUCCESS | One-time PAY/RECEIVE transaction, already settled (with a history entry). |
| … PENDING | A pending one-time item. |
| … FAILED | Nothing recorded. The event is still PROCESSED, and the payment status is FAILED. |
| `payment.status_update` | Settles the pending item (SUCCESS) or removes it (FAILED). Repeats are a no-op. |
| `payment_request.created` | A `paymentRequests` document (PENDING). |
| `mandate.debit_attempt` | An attempt record. SUCCESS settles the mandate's recurring PAY item for that due date. |
| `mandate.attempt_update` | Resolves a PENDING attempt once. |
| `investment.trade` | `investmentTxns` on an import holding. Never written to `transactions`. FIFO, oversell and SIP rules apply. |

## GateKeeper

- **Authentication:** `gate(op, bucket)` in `src/server/guard.ts` wraps every write action:
  - `requireUser()`, Better Auth verified against the database;
  - the per-user rate limit;
  - a request id for logs.
  - The user id never comes from the client.
- **Webhook authentication:** `x-sim-signature` is HMAC-SHA256 over `${x-sim-timestamp}.${body}`, compared in constant time.
  - The timestamp must be within ±5 minutes.
  - The demo account reference in the payload decides the owner.
  - An in-app delivery must belong to the signed-in user, or it is rejected with `403`.
- **Rate limiting** (`src/server/ratelimit.ts`): fixed-window counters in MongoDB (`apiRateLimits`, TTL), so they work across serverless instances.

| Bucket | Limit | If the database is down |
| --- | --- | --- |
| `tx.write` (create, edit, settle, archive, pause) | 60/min per user | closed (refused) |
| `finance.write` (goals, loans, investments, settings) | 60/min per user | closed |
| `integration.simulate` | 30/min per user | closed |
| `request.decide` | 30/min per user | closed |
| `mandate.config` | 20/min per user | closed |
| `event.retry` | 20/min per user | closed |
| `webhook.ip` | 120/min per IP (hashed) | closed |
| `export` | 10/min per user | open |
| `search` (fund search) | 30/min per user | open |

  Rejections are stored for 30 days in `gatekeeperRejections` and shown on the monitoring page.
- **Validation:** Zod at every boundary:
  - adapters, for provider payloads;
  - `src/lib/integrations/validation.ts`, for hub forms;
  - console filters, where unknown values are dropped;
  - ids, which must be 24-hex.
  - Amounts are integer paise, never floats.
- **Structured logs** (`src/server/log.ts`): one JSON line per event, with `ts`, `level`, `op`, `requestId`, `eventId`, a hashed `user`, `durationMs`, `outcome`, `status` and `errorCategory`.
  - Keys that look sensitive (password, token, secret, cookie, signature, session, body, payload) are dropped.
  - Stack traces are written only for unexpected errors, and only in server logs.

## Collections and indexes added

| Collection | Indexes |
| --- | --- |
| `idempotencyKeys` | unique `(userId, scope, key)`; TTL `expiresAt` |
| `integrationEvents` | unique `(userId, provider, externalEventId)`; `(userId, receivedAt -1)`; `(userId, status, nextRetryAt)`; `(status, leaseUntil)` |
| `integrationConnections` | unique `(userId, provider)`; unique `accountRef` |
| `paymentRequests` | unique `(userId, provider, externalRequestId)`; `(userId, status, createdAt -1)` |
| `mandates` | `(userId, status)`; unique partial `(userId, requestId)` |
| `mandateAttempts` | unique `(userId, mandateId, dueDate, attemptNo)`; unique partial `(userId, mandateId, dueDate)` where `status = SUCCESS` |
| `auditLog` | `(userId, at -1)` |
| `apiRateLimits` | TTL `expiresAt` |
| `gatekeeperRejections` | `(userId, at -1)`; TTL `expiresAt` |
| `holdings` (existing) | new unique partial `(userId, importKey)` |

New optional fields on existing documents:

- **`transactions.source`:** where an item came from (integration, payment request or mandate).
- **`holdings.txnSeq`:** the trade counter that serialises concurrent sells.
- **`holdings.importKey`:** set on holdings created by an import.

Existing documents stay valid.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `INTEGRATIONS_WEBHOOK_SECRET` | optional | HMAC secret for webhook deliveries, at least 16 characters. If unset, it's derived from `BETTER_AUTH_SECRET`. |
| `CRON_SECRET` | optional | Enables `/api/cron/integrations`; Vercel Cron sends it as a Bearer token. Without it the route returns 503 (fail closed). |

`vercel.json` schedules the worker daily (`0 3 * * *`, allowed on the Hobby plan). Mandate debits are **never** automatic: they run only when the user triggers them in the hub.

## Tests

- `npm test`: unit tests, including adapters, rules, signatures, hub validation and unauthenticated access to every hub action.
- `npm run test:integration`: real-MongoDB tests (47).
  - Each test file uses a throwaway database `pt_it_<random>_test`, which is emptied afterwards.
  - It reads `MONGODB_TEST_URI`, or `MONGODB_URI` from `.env.local`.
  - The database must be a replica set (Atlas), because the tests need transactions.
  - They cover:
    - idempotency, including concurrent same-key requests, a retry after a failure and an abandoned lease;
    - concurrent settles, a stale edit after a settlement, pause/resume;
    - concurrent sells and duplicate trades;
    - the loan rollback;
    - the rate-limit threshold;
    - duplicate and concurrent deliveries, and payload conflicts;
    - signature, stale-timestamp, invalid-payload, cross-user and unknown-account rejections;
    - transient failure with rollback and retry;
    - crash recovery;
    - pending-payment resolution;
    - duplicate and concurrent payment-request accepts;
    - autopay retries, pending blocking and concurrent success;
    - investment imports, oversell and SIP duplicates.

## Demonstrating the hub

1. Sign in and open **Integrations Hub**. Connect the five demo providers on the Overview tab.
2. **Simulators → UPI payments:** send ₹1,500 to "Rahul" with outcome Success.
   - The result panel shows the event id and outcome, and a settled PAY transaction appears under Transactions.
   - Try **Pending**, then resolve it from Overview ("Provider: success" or "Provider: failed").
3. **Failure handling:** open *Failure injection*.
   - **Fail first attempt:** the event shows RETRY_PENDING and nothing is recorded. Open it in the **Event console** and click **Retry processing**: it's processed once, on attempt 2.
   - **Simulate a crash:** the event stays PROCESSING. After about 30 s, **Run retry worker** recovers it and processes it once.
4. **Duplicates:** on any event, click **Resend same event**. It's blocked, and its "dup blocked" count rises.
5. **Payment request:** simulate one, then on **Requests** accept it (even with a double-click, only one payment is recorded) or reject it (nothing is recorded).
6. **Autopay:** create a mandate.
   - Run a **failed** debit, then a **successful** one. The linked recurring item is marked paid and moves to the next due date.
   - Tick **Re-send the last attempt** to see the duplicate blocked.
7. **Investment import:** import "Buy 10 Nifty BeES". It appears under Investments.
   - Selling more units than you hold fails with a clear reason and records nothing.
8. **Monitoring:** totals, duplicates prevented, failures, retries, average and p95 processing time, autopay outcomes and GateKeeper rejections. All are computed from stored data.

## Known limitations

- **Simulated providers only.** A real integration needs the provider's approval, its own authentication (OAuth, mTLS or its signature scheme) and legal and compliance work.
- **Cron:** the scheduled worker runs daily on Vercel Hobby. In between, retries run when the user retries or clicks "Run retry worker".
- **Rate limits use fixed windows,** so a burst at a window boundary can briefly allow up to twice the limit.
- **Effectively-once side effects depend on MongoDB transactions** (Atlas). With `MONGODB_TRANSACTIONS=false` (a standalone mongod) the pipeline still deduplicates, but a crash between a write and its completion marker is not atomic.
- **Clock skew:** the timestamp window is ±5 minutes.
- **Payload retention:** simulated raw payloads are stored (capped at 16 KB) so deliveries can be replayed for the demo. A real integration should store only what it needs.
