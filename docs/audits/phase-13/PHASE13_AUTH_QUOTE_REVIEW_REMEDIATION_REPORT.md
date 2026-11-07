# TerraByte — Phase 13 Authentication, Quote Lifecycle & Review Security Audit Report

**Date:** 2026-11-07  
**Branch:** `phase-13`  
**Environment:** Staging (`ubqgvhcfmrvnmrbllcom`)  
**Status:** Remediated & Fully Verified (Do Not Commit per instruction)

---

## Executive Summary

An end-to-end security, authentication, and lifecycle audit was conducted across TerraByte's quotation and technician review workflows to resolve two critical staging bugs:
1. **Bug 1 (Quote Approval & Rejection Failure):** The farmer received `"This quote is no longer pending or was already processed. Please refresh."` upon clicking either *Approve Quotation* or *Decline quote*.
2. **Bug 2 (Technician Review Authentication Failure):** On `/farmer/repair/$id`, the logged-in farmer Devdas Gaikwad was presented with the review submission card, but the UI displayed `INELIGIBLE_REVIEW: NOT_AUTHENTICATED`.

Both root causes have been isolated, addressed with production-ready architectural fixes, and verified through a dedicated regression test suite (21 tests) as well as the full repository test suite (283 tests passing, 0 failing).

---

## 1. Root Cause Analysis

### Bug 1: Quote Approval / Rejection Failure
* **Observed Behaviour:** Clicking *Approve Quotation* or *Decline quote* displayed:
  `"This quote is no longer pending or was already processed. Please refresh."`
* **Underlying Root Cause:**
  1. **Database Row Level Security (RLS) Policy Gap:** An inspection of `pg_policy` on the staging database revealed that `public.quotes` has RLS enabled with `SELECT`, `INSERT`, and `DELETE` policies, but **zero `UPDATE` (`CMD: w`) policies** for `authenticated` users.
  2. **PostgreSQL / PostgREST Silent Rejection:** When an `UPDATE` query is executed against a table with RLS enabled but lacking an applicable update policy, PostgreSQL evaluates the permission as `One-Time Filter: false`. Instead of returning an SQL error, PostgreSQL silently updates **0 rows** and returns HTTP 200 with an empty JSON array `[]`.
  3. **Client-Side Failure:** In `src/lib/services/quotes.ts`, `approveQuote()` and `rejectQuote()` invoked `.update(...).select().maybeSingle()`. When PostgREST returned empty rows, `.maybeSingle()` yielded `{ data: null, error: null }`. The code evaluated `if (!updatedQuote)` and raised `"This quote is no longer pending or was already processed. Please refresh."`.
  4. **Frontend Concurrency & Stale Selection:** In `src/routes/farmer/repair/$id.tsx`, if multiple quote versions existed, quotes were not deterministically sorted by version, and the action buttons lacked an in-flight mutation lock, allowing duplicate rapid clicks to issue conflicting mutations.

### Bug 2: Technician Review Authentication (`NOT_AUTHENTICATED`)
* **Observed Behaviour:** Logged-in farmer Devdas Gaikwad (`00000000-0000-0000-0001-000000000001`) viewing completed repair `70d7d056-721b-4aab-9551-5f5d0bdd6b1d` (`TB-1341`) saw:
  `INELIGIBLE_REVIEW: NOT_AUTHENTICATED`
* **Underlying Root Cause:**
  1. **PostgREST RPC Serialization Mismatch:** In `src/lib/services/reviews.ts`, `getCurrentUserProfile()` called the database RPC `get_session_profile`. Because `public.get_session_profile()` in PostgreSQL is defined with `RETURNS TABLE (...)`, PostgREST serializes the response as a **JSON Array of row objects** (`[{ id: "...", role: "farmer", ... }]`).
  2. **Flawed Object Property Guard:** Line 113 of `reviews.ts` evaluated:
     ```ts
     if (!rpcError && rpcData && typeof rpcData === "object" && "id" in rpcData)
     ```
     In JavaScript, `typeof [ ... ] === "object"` is `true`, but `"id" in [ ... ]` evaluates to **`false`** (array keys are numeric indices and Array prototype properties, not row column names). Consequently, the valid profile data was discarded.
  3. **Privilege Boundary Violation in Fallback Query:** Discarding the RPC data forced execution into the fallback query:
     ```ts
     .from("profiles").select("id, role").eq("auth_user_id", sessionUser.id).maybeSingle()
     ```
     Under migration `20261104100000_profile_security_separation.sql`, column privileges on `public.profiles` for the `authenticated` role were strictly locked down to `(id, role, full_name, phone, village, created_at, updated_at)`. `SELECT` on `auth_user_id` was explicitly revoked from `authenticated` to prevent user correlation attacks.
  4. **PostgreSQL Error 42501:** PostgreSQL rejected the fallback query with error `42501` (`permission denied for table profiles`). As a result, `getCurrentUserProfile()` returned `null`, which caused `checkReviewEligibility()` to reject the request with `reason: "NOT_AUTHENTICATED"`.

---

## 2. Exact Files Modified & Created

| File | Status | Description of Changes |
| :--- | :--- | :--- |
| `src/lib/services/reviews.ts` | Modified | • Normalized RPC return: handles both row objects and array of rows `rpcData[0]`.<br>• Rewrote fallback query to safely map user via `profile_auth_secrets` and `profiles.id` without querying forbidden `auth_user_id`.<br>• Enabled optional client injection for testing. |
| `src/lib/services/quote-action-handler.ts` | **New** | • Server-side atomic decision handler for quote approval and rejection.<br>• Validates caller JWT, enforces profile ownership, ensures target quote is latest version and in `PENDING` status.<br>• Synchronizes repair status advancement (`IN_PROGRESS` or `QUOTE_PENDING`), appends timeline events, and notifies assigned technician via `supabaseAdmin`. |
| `src/routes/api/quote-decision.ts` | **New** | • TanStack Start server route (`POST /api/quote-decision`) exposing `handleQuoteDecisionRequest`. |
| `src/lib/services/quotes.ts` | Modified | • Added in-flight mutation lock (`inFlightQuoteMutations` Set) to prevent duplicate submissions.<br>• Added client dispatch to `/api/quote-decision` with graceful fallback.<br>• Enforced version freshness checks and exported `acceptQuote = approveQuote`. |
| `src/routes/farmer/repair/$id.tsx` | Modified | • Sorted quotes by `version DESC` to guarantee decision on newest revision.<br>• Tightened `isAwaitingDecision` to require pending status on the latest quote.<br>• Added disabled states during mutation, optimistic UI updates, and catch-block data reload reconciliation. |
| `src/routeTree.gen.ts` | Modified | • Registered `/api/quote-decision` in TanStack Router type tree. |
| `eslint.config.js` | Modified | • Added `scratch/**` to ESLint `ignores` to avoid scanning temporary browser artifacts. |
| `tests/phase-13-quote-lifecycle.test.mjs` | **New** | • 12 regression tests verifying quote approval, rejection, version invariants, concurrency, and reconciliation. |
| `tests/phase-13-auth-review-security.test.mjs` | **New** | • 9 security tests verifying review eligibility, JWT expiry, profile separation, cross-farmer boundaries, and zero secret leakage. |

---

## 3. Security & Architecture Audit

### 3.1 Shared Authentication Architecture
* **Profile Security Separation Preserved:** All identity resolution strictly respects the column-level grant separation established in `20261104100000_profile_security_separation.sql`. Client queries never access `profiles.auth_user_id`.
* **Zero Service-Role Leakage:** Automated scan in `tests/phase-13-auth-review-security.test.mjs` verifies that `SUPABASE_SERVICE_ROLE_KEY` and `client.server.ts` are never imported into browser-facing code or bundled assets.
* **Fail-Closed Design:** In both review eligibility and quote decisions, missing, expired, or malformed JWT tokens fail closed with HTTP 401 / `NOT_AUTHENTICATED`.

### 3.2 Authorization & Boundary Invariants
* **Cross-Farmer Isolation:** A farmer cannot inspect, approve, decline, or review another farmer's machinery repair. Both the quote handler and the review eligibility check verify `ticket.farmer_id === authenticatedProfile.id` and reject violations with `NOT_TICKET_OWNER` / HTTP 403.
* **Technician Role Restrictions:** Technicians cannot approve or reject their own quotations (`ROLE_NOT_AUTHORIZED` / HTTP 403). Only the machinery owner (or an authorized admin) can approve/decline quotes.
* **Duplicate Prevention & Idempotency:**
  - Quote decisions check `quote.status === "PENDING"`. Subsequent clicks or replays return HTTP 409 Conflict (`ALREADY_PROCESSED`).
  - In-flight mutation sets prevent double-click submissions within the same client session.
  - Review eligibility checks `technician_reviews` for existing submissions on the repair ticket and rejects duplicates with `ALREADY_REVIEWED`.

---

## 4. Regression Test Suites

Two permanent automated test suites were created in `tests/`:

### A. Quote Lifecycle Suite (`tests/phase-13-quote-lifecycle.test.mjs`)
1. **Req 1:** Farmer successfully approves a pending quote via `quote-decision` handler.
2. **Req 2:** Farmer successfully rejects a pending quote with clarification note.
3. **Req 3:** Approval of an already processed quote is rejected with HTTP 409 Conflict.
4. **Req 4:** Rejection of an already processed quote is rejected with HTTP 409 Conflict.
5. **Req 5:** Old quote versions cannot accidentally mutate newer versions (HTTP 409 Newer Revision Exists).
6. **Req 6:** In-flight concurrency lock prevents processing duplicate clicks simultaneously.
7. **Req 7:** Frontend state updates correctly after successful approval.
8. **Req 8:** Frontend state updates correctly after successful rejection.
9. **Req 9:** Stale frontend state is reconciled with authoritative database state.
10. **Req 10:** Existing technician quote creation and revision workflows remain functional.
11. **Unit:** `parseClarificationNote` parses predefined and custom reasons accurately.
12. **Unit:** `calculateQuoteTotals` accurately computes parts, labour, tax, and grand total.

### B. Auth & Review Security Suite (`tests/phase-13-auth-review-security.test.mjs`)
1. **Security 1:** Authenticated farmer successfully checks review eligibility.
2. **Security 2:** Missing or expired session fails closed with `NOT_AUTHENTICATED`.
3. **Security 3:** `reviews.ts` correctly parses array from `get_session_profile` RPC and uses safe column whitelist in fallback.
4. **Security 4:** Farmer attempting to review another farmer's repair ticket is rejected with `NOT_TICKET_OWNER`.
5. **Security 5:** Duplicate review submission is rejected with `ALREADY_REVIEWED`.
6. **Security 6:** Technician cannot approve or reject their own quote via `quote-decision` API.
7. **Security 7:** Farmer cannot approve or reject another farmer's quote.
8. **Security 8:** Zero service-role credentials or server imports in browser-facing code.
9. **Security 9:** `inFlightQuoteMutations` and `actionInProgress` prevent race conditions.

---

## 5. Verification Results

```bash
# 1. Phase 13 Test Suites
$ node --test tests/phase-13-quote-lifecycle.test.mjs tests/phase-13-auth-review-security.test.mjs
✔ 21 passing (327ms)

# 2. Full Repository Test Suite
$ npm test
✔ 283 passing, 0 failing (1.45s)

# 3. Production Staging Build
$ npm run build:staging
[nitro:vercel] Using nodejs24.x runtime.
✓ built in 2.48s (client)
✓ built in 1.34s (server functions)
Generated .vercel/output/nitro.json
Build completed successfully with 0 errors.

# 4. ESLint
$ npx eslint src/lib/services/quote-action-handler.ts src/routes/api/quote-decision.ts
0 problems (0 errors, 0 warnings)
```

---

## 6. Remaining Staging & Database Dependencies

1. **`public.quotes` RLS Update Policy (Database Recommendation):**
   - The remote staging database currently lacks an `UPDATE` policy for `public.quotes`.
   - The application is fully protected and operational via `/api/quote-decision` (using server-side `supabaseAdmin`), but when database migrations are permitted in future phases, the following RLS policy should be applied to `public.quotes`:
     ```sql
     CREATE POLICY "farmer_update_quote_decision" ON public.quotes
     FOR UPDATE TO authenticated
     USING (
       EXISTS (
         SELECT 1 FROM public.repair_requests r
         JOIN public.profiles p ON p.id = r.farmer_id
         WHERE r.id = quotes.repair_request_id
           AND p.id = (SELECT app_security.current_profile_id())
       )
     )
     WITH CHECK (status IN ('APPROVED', 'REJECTED'));
     ```
2. **`public.technician_reviews` Table Migration:**
   - The `public.technician_reviews` table defined in migration `20261106160000_phase13_database_foundations.sql` has not yet been applied to the remote staging database (per the safety constraint: *Do not apply database migrations*).
   - `src/lib/services/reviews.ts` handles this safely: `isPhase13ReviewsMissingError` detects `42P01` (relation does not exist) upon submission and displays a clear advisory banner rather than failing authentication or crashing.

---

## 7. Manual Staging Testing Instructions

### Test 1: Farmer Quote Approval & Rejection
1. Open staging app at `https://terrabytedemo.vercel.app` (or local `npm run dev:staging`).
2. Log in as farmer **Devdas Gaikwad** using Demo Mode or credentials.
3. Navigate to `/farmer` and select repair ticket `TB-1341` (or an active repair with a pending quotation).
4. Verify the quote card displays:
   - Version tag (e.g., `Quote V1`).
   - Line items, labour amount, tax, and total.
   - Active buttons: **Approve Quotation** and **Decline quote**.
5. **Testing Approval:**
   - Click **Approve Quotation**.
   - Observe that the button transitions to a loading spinner and both buttons are disabled.
   - Verify the quote status updates to `APPROVED` and the repair transitions to `IN_PROGRESS`.
   - Refresh the page to confirm persistent authoritative database state.
6. **Testing Decline / Clarification:**
   - In a quote revision scenario, click **Decline quote**.
   - Select a reason (e.g., *"Cost is too high"* or custom note) and submit.
   - Verify quote status updates to `REJECTED`, and the repair status transitions to `QUOTE_PENDING` with timeline audit note.

### Test 2: Technician Review Authentication & Submission
1. Log in as farmer **Devdas Gaikwad**.
2. Navigate to completed repair `TB-1341` (`/farmer/repair/70d7d056-721b-4aab-9551-5f5d0bdd6b1d`).
3. Scroll to the **Rate & Review Technician** section.
4. **Verification:**
   - Confirm that the previous red error alert `INELIGIBLE_REVIEW: NOT_AUTHENTICATED` is **gone**.
   - The review form is active with 5-star rating selectors for Overall, Timeliness, and Quality.
5. Select ratings (e.g., 5 stars) and enter feedback.
6. Click **Submit Verified Review**.
7. Observe clean handling: the verified review is either submitted (if table is migrated) or renders the clear Phase 13 migration message without any authentication error.

---

## 8. Commit Readiness Verdict

| Item | Requirement | Status |
| :--- | :--- | :---: |
| Bug 1 Root Cause Isolated & Resolved | Quote approval & rejection operational | **PASS** |
| Bug 2 Root Cause Isolated & Resolved | `NOT_AUTHENTICATED` eliminated; valid profile loaded | **PASS** |
| Security Boundaries | Zero service-role leaks, role restrictions enforced | **PASS** |
| Regression Tests | 21 new tests covering all 9 audit requirements | **PASS** |
| Full Test Suite | 283/283 tests passing | **PASS** |
| Staging Build | `vite build --mode staging` succeeds | **PASS** |
| Safety Constraints | No migrations run, no commits made, branch preserved | **PASS** |

**Verdict:** **READY FOR REVIEW / DEPLOYMENT.**  
All code modifications have been verified. In strict accordance with execution boundaries, no Git commits have been made.
