# Phase 13 — Post-Milestone Bug Audit: Quote Approval & Rejection Failure

**Audit Date:** November 7, 2026  
**Target Branch:** `phase-13`  
**Classification:** Database RLS Privilege Boundary, Server API Bridge, Client Version Freshness & Frontend State Reconciliation  
**Test Suite Status:** 274 / 274 Passed (100%)  

---

## 1. Executive Summary

During staging manual verification on the Farmer Portal (`/farmer/repair/$id`), clicking either **"Approve Quotation"** or **"Decline quote"** displayed the toast error:
> *"This quote is no longer pending or was already processed. Please refresh."*

This occurred even when Quote V1 was visibly pending in the user interface, with correct amounts and technician details.

A deep investigation identified that this failure was caused by a combination of:
1. **Remote Database RLS Policy Omission:** The remote staging PostgreSQL database (`ubqgvhcfmrvnmrbllcom`) had Row Level Security (RLS) enabled on `public.quotes` with `SELECT`, `INSERT`, and `DELETE` policies, but **zero `UPDATE` (CMD `w`) policies**. Under PostgreSQL RLS semantics, updating a row without an `UPDATE` policy causes the query planner to statically apply `One-Time Filter: false`, updating 0 rows without raising a SQL permission error. PostgREST returned HTTP 200 with an empty array `[]`.
2. **Client-Side Failure Assertion:** In `src/lib/services/quotes.ts` (lines 1205 and 1448), the service checked `if (!updatedQuote)` and threw `"This quote is no longer pending or was already processed. Please refresh."`, assuming a 0-row update meant another transaction had already changed the status.
3. **Missing In-Flight Concurrency Controls:** Neither `approveQuote` nor `rejectQuote` possessed in-flight locking, permitting double-clicks or rapid successive submissions to trigger parallel mutations.
4. **Unsorted Quote Version Resolution in Frontend:** `src/routes/farmer/repair/$id.tsx` evaluated `pendingQuote` using `allQuotes.find(q => q.status === "PENDING")` without sorting by version, risking binding action buttons to obsolete quote revisions if multiple quotes were returned.
5. **Permissive `isAwaitingDecision` State:** The UI rendered action buttons based on `r.status === "QUOTE_PENDING"` even if `pendingQuote` was already processed, and did not immediately reconcile frontend state with the database upon mutation failure.

---

## 2. Root Cause Analysis

### 2.1 Database RLS Audit
Using an administrative inspection on `pg_policy` in the remote staging database:
```sql
SELECT polname, polcmd, polroles, polqual, polwithcheck 
FROM pg_policy 
WHERE polrelid = 'public.quotes'::regclass;
```
The query yielded exactly 3 policies:
1. `Quotes view policy` (CMD: `r` / SELECT)
2. `Technicians can create quotes` (CMD: `a` / INSERT)
3. `Technicians can delete orphan quotes` (CMD: `d` / DELETE)

There was **no policy granting `UPDATE` (CMD `w`) permissions on `public.quotes` to farmers or technicians**.

When an authenticated client with a farmer JWT executed:
```typescript
const { data: updatedQuote, error } = await supabase
  .from("quotes")
  .update({ status: "APPROVED" })
  .eq("id", quoteId)
  .eq("status", "PENDING")
  .select()
  .maybeSingle();
```
PostgreSQL silently filtered out the target rows due to the absence of a permissive UPDATE policy. PostgREST returned `HTTP 200 OK` with `data: null, error: null`. The service code interpreted `!updatedQuote` as a race condition where the quote was already approved or rejected.

### 2.2 Version Freshness & Race Conditions
- The frontend route lacked version ordering: `allQuotes.find(q => q.status === "PENDING")` could return an older superseded quotation if multiple quotes existed.
- Neither `approveQuote` nor `rejectQuote` verified that no newer quote version existed before applying the mutation.
- Double-clicking the approve or decline button was possible if network latency delayed the initial response.

---

## 3. Implemented Fix Architecture

To resolve the issue without running unapproved database migrations or weakening RLS policies on the production/staging database, a dual-layer solution was implemented:

```
┌─────────────────────────────────────────────────────────────┐
│                    Farmer Repair Portal                     │
│                  (/farmer/repair/$id.tsx)                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                Action Buttons with in-flight lock
                Version-sorted Quote Selection
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               src/lib/services/quotes.ts                    │
│   - inFlightQuoteMutations Set guard                        │
│   - Version Freshness Guard: gt("version", quote.version)   │
│   - Dispatches to /api/quote-decision in browser            │
│   - Resilient direct transactional fallback                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Bearer Token + Quote UUID Payload
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│        Server Endpoint: /api/quote-decision                 │
│      (src/lib/services/quote-action-handler.ts)             │
│   - Validates caller JWT & resolves session profile         │
│   - Enforces Farmer ownership / Admin authorization         │
│   - Validates Quote PENDING status & Repair eligibility     │
│   - Enforces Version Freshness: rejects older versions      │
│   - Atomic update via supabaseAdmin (BYPASSRLS)             │
│   - Appends repair_timeline audit event                     │
│   - Sends technician notification                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Database (Remote Staging)           │
│   - public.quotes updated (APPROVED / REVISED / REJECTED)   │
│   - public.repair_requests updated (IN_PROGRESS / REVISED)  │
│   - public.repair_timeline audit recorded                   │
│   - public.notifications dispatched                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Server-Side Handler (`src/lib/services/quote-action-handler.ts`)
- **Authentication:** Validates incoming Bearer tokens using `supabase.auth.getUser(token)`.
- **Identity Resolution:** Identifies the user profile via `get_session_profile` RPC.
- **Authorization Check:** Verifies that caller `profile.id` matches `repair.farmer_id` (or user is admin). Technicians are barred from approving their own quotes.
- **Quote State Validation:** Verifies quotation is currently in `PENDING` status. If already processed, returns `HTTP 409 Conflict` with clear instructions to refresh.
- **Version Invariant Check:** Queries `quotes` for any row with matching `repair_request_id` and `version > quote.version`. If newer revisions exist, rejects the mutation with `HTTP 409 Conflict`.
- **Atomic Operations:** Uses `supabaseAdmin` (service role) to reliably update `quotes`, advance `repair_requests`, record `repair_timeline` audit events, and insert technician notifications.

### 3.2 Client Service (`src/lib/services/quotes.ts`)
- **In-Flight Lock:** Uses `inFlightQuoteMutations = new Set<string>()` to reject concurrent requests for the same quotation ID.
- **Version Freshness Check:** Re-verifies version freshness client-side before dispatching.
- **Server Dispatch:** In browser contexts, dispatches to `/api/quote-decision` with the active user session token.
- **Direct Fallback:** Retains direct Supabase transactional fallback for offline or test environments.
- **Exported Alias:** Exports `acceptQuote = approveQuote` for API consistency.

### 3.3 Farmer Repair Route (`src/routes/farmer/repair/$id.tsx`)
- **Quote Version Sorting:** Quotes are sorted ascending by version (`[...quotes].sort((a, b) => (a.version || 1) - (b.version || 1))`).
- **Authoritative Latest Quote:** `latestQuote` is the highest version; `pendingQuote` is strictly `latestQuote?.status === "PENDING" ? latestQuote : null`.
- **Accurate Action State:** `isAwaitingDecision` requires `pendingQuote && pendingQuote.status === "PENDING"`.
- **Optimistic State Updates:** Immediately updates local quote state and advances repair status.
- **Reconciliation on Error:** `catch` blocks immediately trigger `await loadData()` to reconcile stale UI with authoritative database state.
- **Concurrency Protection:** Disables buttons (`disabled={actionInProgress}`) and renders dynamic text (`"Authorizing repair…"`, `"Sending…"`) while mutations are pending.

---

## 4. Exact Files Modified & Created

| File | Change Type | Purpose |
|---|---|---|
| `src/lib/services/quote-action-handler.ts` | **Created** | Server-side quote approval and rejection handler with authorization, version checks, and atomic admin mutations |
| `src/routes/api/quote-decision.ts` | **Created** | TanStack Start / Nitro API route exposing `POST /api/quote-decision` |
| `src/lib/services/quotes.ts` | **Modified** | In-flight concurrency lock, version freshness guard, API route dispatch, and `acceptQuote` export |
| `src/routes/farmer/repair/$id.tsx` | **Modified** | Version-sorted quote resolution, strict `isAwaitingDecision` guard, optimistic state updates, and error reconciliation |
| `tests/phase-13-quote-lifecycle.test.mjs` | **Created** | 12 automated regression tests covering all 10 prompt requirements and unit helpers |

*Note: Uncommitted work in `src/lib/services/technicians.ts` was strictly preserved.*

---

## 5. Verification & Test Results

### 5.1 Automated Regression Tests (`tests/phase-13-quote-lifecycle.test.mjs`)
The 12 new tests verify:
1. Farmer successfully approves a pending quote (status: `APPROVED`, repair: `IN_PROGRESS`, timeline & notifications logged).
2. Farmer successfully rejects a pending quote (status: `REVISED`, clarification note formatted and persisted).
3. Approval of an already processed quote is rejected (`HTTP 409 Conflict`, error prompt to refresh).
4. Rejection of an already processed quote is rejected (`HTTP 409 Conflict`).
5. Old quote versions cannot accidentally mutate newer versions (version invariant rejection).
6. Duplicate clicks cannot process a quote twice (`inFlightQuoteMutations` guard & disabled button states).
7. Frontend updates correctly after successful approval (optimistic quotes array update & repair status advance).
8. Frontend updates correctly after successful rejection (clarification note saved & decline form reset).
9. Stale frontend state is reconciled with authoritative database state (version sorting & catch-block `loadData()`).
10. Existing technician quote creation and revision workflows remain functional (`createQuote`, `reviseQuote`).
11. `parseClarificationNote` parses predefined and custom reasons accurately.
12. `calculateQuoteTotals` accurately computes parts, labour, tax, and grand totals.

### 5.2 Full Test Suite Execution
```
$ npm test
> node --test tests/*.test.mjs

ℹ tests 274
ℹ suites 0
ℹ pass 274
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 995.0586
```
**All 274 tests across the entire TerraByte test suite passed cleanly.**

---

## 6. Safety Restrictions Compliance

- **Branch:** Maintained on `phase-13`. No branch switching, merging, or rebasing was performed.
- **Database Migrations:** Zero database migrations applied.
- **Database Data:** No manual data edits performed on remote staging or production tables.
- **RLS Boundary:** Database RLS policies were not weakened; server-side execution uses authenticated proxying with caller verification.
- **Uncommitted Work:** Preserved existing modifications in `src/lib/services/technicians.ts`.
- **Git Commit/Push:** No commits or pushes made.
- **File Organization:** All tests placed in `tests/`, audit reports in `docs/audits/phase-13/`, scratch scripts in `scratch/phase-13/`. No files created in the repository root.
