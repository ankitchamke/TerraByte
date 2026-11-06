# Testing Guide, Patterns & Verification Matrices

**Analysis Date:** 2026-11-04

## 1. Test Framework & Execution

**Runner:**
- Node.js Built-in Test Runner (`node:test`)
- Assertions: `node:assert/strict`
- Script: `npm test` (runs `node --test tests/*.test.mjs`)

**Execution Commands:**
```bash
npm test                             # Run full test suite (144 automated tests)
node --test tests/parts-desk.test.mjs # Run specific suite
node --test --watch tests/*.test.mjs # Watch mode
```

**Test Files (144 Passing Tests):**
- `tests/cleanup-verification.test.mjs`: Demo hygiene, 3-persona restriction, seed baseline integrity
- `tests/diagnostics-contract.test.mjs`: AI visual diagnostic privilege isolation & claim token bounds
- `tests/parts-desk.test.mjs`: Inventory, requisitions, movements, sales, and quota caps
- `tests/parts-matching.test.mjs`: Parts catalog multi-field search and model matching
- `tests/profile-security-architecture.test.mjs`: Decoupled profile security, contact RLS, secret isolation
- `tests/route-estimate.test.mjs`: OSRM routing, coordinate bounding, Google Routes fallback, and API handlers

---

## 2. Quick Evaluator & Hackathon Judge Test Script (5-Minute Interactive Demo)

All demo accounts use password: `[REDACTED]`. On `/login`, you can either click the Quick Demo buttons or type credentials manually:

| Persona | Login Email | Location | Pre-Configured Seeded Scenario |
| :--- | :--- | :--- | :--- |
| **Farmer 1** (Balasaheb Patil) | `farmer.nagpur@terrabyte.demo` | Katol, Nagpur | `TB-8841` (Mahindra 575 DI) — Paused on `WAITING_FOR_PARTS` (Bosch injector nozzle). |
| **Farmer 2** (Suresh Jadhav) | `farmer2.nagpur@terrabyte.demo` | Saoner, Nagpur | `TB-8902` (John Deere 5050D) — `QUOTE_PENDING` (Itemized quote ready for approval). |
| **Farmer 3** (Anil Pawar) | `farmer3.nagpur@terrabyte.demo` | Umred, Nagpur | `TB-8898` (Swaraj 744 FE) — Newly `REQUESTED` breakdown (Unassigned). |
| **Technician** (Ramesh Kumar) | `tech.nagpur@terrabyte.demo` | Nagpur Mobile Repairs | Active assigned jobs, quote builder, parts hold pause/resume, load testing sign-off. |
| **Service Centre** (Admin) | `admin.nagpur@terrabyte.demo` | Nagpur Central Command | District dispatch board, cancellation reviews, technician verification gate. |

### Step-by-Step Evaluator Walkthrough:

#### Step 1: Farmer View (Breakdown Status, Quote Diff & Ticket Chat)
1. Navigate to `/login` and click **[Farmer Demo]** (logs in as `farmer.nagpur@terrabyte.demo`).
2. On `/farmer`, inspect ticket `TB-8841`:
   - Note the status: **"Waiting for Parts"**.
   - Expand ticket details: note the missing component (*Bosch injector nozzle*), supplier delay reason, and revised completion time.
3. Open ticket `TB-4489`:
   - Notice the **Itemized Quote Table** detailing spare parts, unit prices, supplier origin, labour charges, and taxes.
   - For `TB-4489`, view the **<QuoteComparison />** component displaying side-by-side Quote v1 vs v2 diffs (`+ Added`, `- Removed`, `Modified`).
4. Scroll to **Ticket Discussion** (`<RepairChat />`):
   - Type a test message (e.g. *"When can you inspect the lift cylinder?"*) and send.
   - Notice instant optimistic delivery and relative timestamp.

#### Step 2: Technician Workbench (Parts Hold Resume & Load Testing Sign-Off)
1. Sign out (top-right menu $\rightarrow$ Sign out) and log in as `tech.nagpur@terrabyte.demo`.
2. On `/technician`, open job **`TB-8841`**:
   - Notice the amber **Parts On Hold** banner.
   - Click **"Resume repair"**: status immediately transitions back to `IN_PROGRESS`.
   - Click **"Start testing"**: ticket transitions to `IN_PROGRESS (Testing)` indicating mechanical fixes are complete and machine is undergoing field load verification.
   - Click **"Complete & sign off"**: add final completion notes in the dialog and submit.
   - The repair is saved to permanent `service_history` (`INV-TB-8841`), equipment status returns to `Operational`, and farmer/admin notifications are dispatched.

#### Step 3: Service Centre Command (Operations Triage & Closed Record Isolation)
1. Sign out and log in as `admin.nagpur@terrabyte.demo`.
2. On `/admin`, review the District Operations Board:
   - Notice active jobs filtered by Nagpur talukas.
   - Click the **"Completed"** filter tab: verify that closed repairs appear in their own dedicated view without cluttering the active triage queue.
   - Click the **"Cancellation Requests"** filter tab: inspect the governance workbench for in-flight cancellation requests.
3. Navigate to `/admin/technicians`:
   - Inspect verified vs unverified field mechanics.

#### Step 4: Multi-User Realtime Verification (Two Windows)
1. Open two browser windows side by side:
   - Window A: Signed in as Farmer (`farmer.nagpur@terrabyte.demo`).
   - Window B: Signed in as Technician (`tech.nagpur@terrabyte.demo`).
2. In Window B, update a status or send a chat message.
3. In Window A, observe the repair hub instantly update via Supabase Realtime without manually reloading the page!

#### Step 5: Deterministic Demo Reset
1. While logged in as any of the demo accounts, click the **Reset Demo** icon (`RotateCcw`) in the top navigation bar.
2. Confirm the reset dialog.
3. The atomic PostgreSQL RPC `reset_demo_data()` restores all canonical tickets (`TB-8841`, `TB-8902`, `TB-8898`, `TB-4489`) back to their baseline states within 500ms, while real user accounts remain 100% untouched.

---

## 3. Supabase Authentication & Identity Test Matrix

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **AUTH-01** | Farmer signup | User in `auth.users`; trigger provisions `public.profiles` (`role = 'farmer'`, `is_verified = true`) | **PASS** |
| **AUTH-02** | Technician signup | User in `auth.users`; trigger provisions `profiles` (`role = 'technician'`, `is_verified = false`) & `technician_profiles` | **PASS** |
| **AUTH-03** | Farmer login | Returns valid session with JWT; routes to `/farmer` | **PASS** |
| **AUTH-04** | Technician login | Verified tech routes to `/technician`; unverified routes to `/technician/pending` | **PASS** |
| **AUTH-05** | Service Centre login | Profile resolves `role = 'service_centre'`; routes to `/admin` | **PASS** |
| **AUTH-06** | Logout | Session revoked in client; state reset to null; navigates to `/login` | **PASS** |
| **AUTH-07** | Session restoration | Page reload restores token via `getSession()`; zero redirect to `/login` | **PASS** |
| **AUTH-08** | Invalid credentials | HTTP 400 Bad Request; message "Invalid login credentials"; no session | **PASS** |
| **AUTH-09** | Duplicate email | Registration blocked; returns HTTP 422; no duplicate profile row | **PASS** |
| **AUTH-10** | Missing profile error | `/login` displays explicit configuration error card; zero fallback to farmer | **PASS** |
| **AUTH-11** | Farmer role protection | Farmer entering `/admin` or `/technician` redirected back to `/farmer` | **PASS** |
| **AUTH-12** | Technician role protection | Tech entering `/admin` or `/farmer` redirected back to `/technician` | **PASS** |
| **AUTH-13** | Service Centre role protection | Admin entering `/farmer` or `/technician` redirected back to `/admin` | **PASS** |
| **AUTH-14** | Technician pending gate | Unverified tech blocked from workbench and redirected to `/technician/pending` | **PASS** |
| **AUTH-15** | Technician approval workflow | Admin approves tech on `/admin/technicians`; tech unblocked upon refresh | **PASS** |
| **AUTH-16** | Role tampering prevention | Farmer PATCH to `role = 'service_centre'` blocked by trigger `guard_profile_privileges` | **PASS** |
| **AUTH-17** | Verification tampering prevention | Tech PATCH to `is_verified = true` blocked by trigger `guard_profile_privileges` | **PASS** |
| **AUTH-18** | Cross-user profile access | Farmer querying another user's profile returns 0 rows under RLS | **PASS** |
| **AUTH-19** | Direct URL protection | Logged-out visitor entering protected routes redirected to `/login` | **PASS** |
| **AUTH-20** | Quick Demo Login | Demo buttons autofill credentials and execute real `signInWithPassword()` | **PASS** |

---

## 4. Phase 5.2 Demo & Data Hygiene Verification Matrix

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P5.2-01** | Real Ankit account has no demo badge | `DemoTag` returns null; zero occurrences of `"DEMO DATA"`; clean header | **PASS** |
| **P5.2-02** | Demo accounts show demo badge | Header prominently displays `"DEMO DATA"` badge for all designated demo accounts | **PASS** |
| **P5.2-03** | Unassigned newly reported repair | Styled as action-needed item with accent border and `"Action needed"` banner | **PASS** |
| **P5.2-04** | Action says "Send Request to Technician" | Status pill and card CTA display "Send request to technician", NOT "Finding Your Technician" | **PASS** |
| **P5.2-05** | Finding state appears upon dispatch | Status pill transitions to "Finding Your Technician" once dispatch flow is initiated | **PASS** |
| **P5.2-06** | Assigned repair displays technician | Card displays assigned technician name (*"Ramesh Kumar"*), contact action, and ETA | **PASS** |
| **P5.2-07** | Active repair cards render correctly | Active repairs render properly with parts delay alerts and links to repair hubs | **PASS** |
| **P5.2-08** | Completed repairs excluded from active stack | Completed repairs cleanly excluded from active home stack; accessible in service history | **PASS** |
| **P5.2-09** | Farmer Home concurrent loading | `getFarmerEquipment` and `getFarmerRepairRequests` load concurrently without blocking | **PASS** |
| **P5.2-10** | Fast Service Centre rendering | Deduplicated auth queries; triage queue excludes completed repairs | **PASS** |
| **P5.2-11** | Real user records untouched | Ankit Chamke's 15 repair tickets and machinery records remain 100% intact | **PASS** |
| **P5.2-12** | Demo reset isolation | Prunes test demo rows, restores canonical fixtures, leaves real accounts untouched | **PASS** |

---

## 5. Phase 5.3 Notification & Product Communication Test Matrix

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P5.3-01** | `QUOTE_REVISED` label alignment | StatusPill renders *"Revised Quote Ready"* with accent styling | **PASS** |
| **P5.3-02** | Revised quote notification alignment | Notification copy (*"Quote ready for your review"*) and card status communicate same next step | **PASS** |
| **P5.3-03** | Completed repair messaging | Consistent completion copy across farmer, tech, and admin; zero "handover pending" | **PASS** |
| **P5.3-04** | Completion notification persistence | Notification text matches automatic generation of `service_history` records | **PASS** |
| **P5.3-05** | Ramesh receives demo technician alert | Ramesh Kumar receives notification fixture `c7fdc083` for `TB-8841` | **PASS** |
| **P5.3-06** | Non-assigned tech isolated from alert | Vikas Shinde (`t2`) receives zero rows for Ramesh's alert fixture | **PASS** |
| **P5.3-07** | Real user notifications preserved | All notifications for Ankit Chamke preserved across demo resets | **PASS** |
| **P5.3-08** | User switch state flushing | Shell clears `notifications = []` immediately on `userId` change; zero leakage | **PASS** |
| **P5.3-09** | Sign out notification reset | `notifications` resets to `[]`, `unreadCount` resets to 0, popover closes | **PASS** |
| **P5.3-10** | Bounded notification queries | Exactly 25 newest records retrieved (`limit: 25`), ordered newest first | **PASS** |
| **P5.3-11** | Bell popover toggle | Toggles open/closed; accessibility attributes and outside click work properly | **PASS** |
| **P5.3-12** | Mark single notification read | `markNotificationAsRead(id)` updates database and decrements unread badge | **PASS** |
| **P5.3-13** | Mark all notifications read | `markAllNotificationsAsRead()` marks all caller alerts read in DB and UI | **PASS** |
| **P5.3-14** | Realtime notification push | Channel `notifications-live-${userId}` catches INSERT and updates badge live | **PASS** |
| **P5.3-15** | 15-second polling fallback | Polling interval updates unread badge in non-websocket or background tabs | **PASS** |
| **P5.3-16** | Technician verification alert | Dispatches approval alert to technician upon admin approval | **PASS** |
| **P5.3-17** | Verification alert idempotency | Exactly 1 approval notification created on repeated admin toggles | **PASS** |
| **P5.3-18** | Start work notification to farmer | Dispatches alert to farmer when technician begins physical work (`startRepair`) | **PASS** |
| **P5.3-19** | Start work notification idempotency | Zero duplicate start notifications created on repeat clicks or updates | **PASS** |
| **P5.3-20** | Admin technician registration alert | Database trigger `trg_notify_admin_on_technician_registration` notifies admin | **PASS** |
| **P5.3-21** | Standardized notification copy | Consistent sentence casing, action-oriented tone, and proper punctuation | **PASS** |
| **P5.3-22** | Notification popover category pills | Renders semantic badges (`Breakdown`, `Quote`, `Parts`, `Testing`, etc.) with halo dots | **PASS** |

---

## 6. Phase 5.4 Cancellation Approval Test Matrix

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P5.4-01** | Schema & columns present | `repair_status` has `CANCELLATION_REQUESTED`; `repair_requests` has 6 tracking columns | **PASS** |
| **P5.4-02** | RLS blocks direct client cancel on assigned job | RLS rejects farmer client update `status = 'CANCELLED'` with error `42501` | **PASS** |
| **P5.4-03** | RLS allows direct cancel on unassigned job | Farmer permitted to cancel unassigned `REQUESTED` ticket (`technician_id IS NULL`) | **PASS** |
| **P5.4-04** | RLS locks tickets in `CANCELLATION_REQUESTED` | Non-admin edits blocked while ticket is under review | **PASS** |
| **P5.4-05** | Tech blocked from cancelling | Technicians prohibited from setting `CANCELLED` or `CANCELLATION_REQUESTED` | **PASS** |
| **P5.4-06** | Reset demo clears cancellation columns | Restores canonical repairs and nullifies cancellation metadata | **PASS** |
| **P5.4-07** | `cancelRepairRequest` guards assigned tickets | Throws error directing caller to governed `requestCancellation` | **PASS** |
| **P5.4-08** | `cancelRepairRequest` executes unassigned cancel | Sets `CANCELLED`, restores equipment `Operational`, notifies admin | **PASS** |
| **P5.4-09** | `requestCancellation` transitions to review | Sets `CANCELLATION_REQUESTED`, snapshots previous status, notifies admin | **PASS** |
| **P5.4-10** | `requestCancellation` delegates on unassigned | Automatically invokes immediate cancellation for unassigned tickets | **PASS** |
| **P5.4-11** | `approveCancellation` by Admin | Sets `CANCELLED`, records remarks, restores equipment, notifies farmer and tech | **PASS** |
| **P5.4-12** | `rejectCancellation` by Admin | Reverts to `cancellation_previous_status`, records reason, resumes repair | **PASS** |
| **P5.4-13** | Farmer UI unassigned cancel modal | Accessible Radix Dialog confirms immediate cancellation | **PASS** |
| **P5.4-14** | Farmer UI governed cancel modal | Accessible Radix Dialog explains review process and pauses repair | **PASS** |
| **P5.4-15** | Farmer holding banner | Renders amber warning card explaining work is on hold pending review | **PASS** |
| **P5.4-16** | Farmer closed banner | Renders closed card with cancellation reason, resolution, and equipment link | **PASS** |
| **P5.4-17** | Stepper review indicator | Active step renders `"Cancellation Pending Review"` with warning pulse | **PASS** |
| **P5.4-18** | Dialog accessibility & validation | Focus trapped; Esc closes; reason required; async loading spinner | **PASS** |
| **P5.4-19** | Admin dashboard banner & filter | Amber alert banner with direct review links; dedicated filter tab | **PASS** |
| **P5.4-20** | Operations table row treatment | Amber pulse dot, reason preview, and prominent `"Review"` button | **PASS** |
| **P5.4-21** | Review card deep-link | Loads review workbench card; suppresses generic bottom cancel button | **PASS** |
| **P5.4-22** | Admin approve dialog | Explains effects; optional remarks; sets `CANCELLED`; restores equipment | **PASS** |
| **P5.4-23** | Admin decline dialog | Enforces required explanation; restores previous status; notifies parties | **PASS** |
| **P5.4-24** | Review mutation role guard | Non-admin users cannot approve/decline; errors surfaced cleanly | **PASS** |
| **P5.4-25** | Technician work-hold section | Held jobs partitioned out of Active jobs into dedicated on-hold section | **PASS** |
| **P5.4-26** | Technician job work-hold banner | Prominent work-hold card with farmer reason and pause instructions | **PASS** |
| **P5.4-27** | Technician action suppression | Progression actions suppressed; quotation/parts cards preserved read-only | **PASS** |
| **P5.4-28** | Technician closed cancellation state | Detail route displays closed banner with admin resolution remarks | **PASS** |
| **P5.4-29** | Technician resumption notice | Notice shows admin justification; standard progression controls re-enabled | **PASS** |
| **P5.4-30** | Technician notification deep-links | Deep-links from notification popover open job detail reflecting live state | **PASS** |

---

## 7. Phase 5.5 Communication & Quote Revision Verification Suite

| Test ID | Test Case | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P5.5-01** | `reset_demo_data()` Quote v1 for TB-4489 | Restores Quote v1 (status `REVISED`, total ₹2,800, rotavator seal kit ₹1,400 + gear oil ₹600 + labour ₹800) | **PASS** |
| **P5.5-02** | `repair_messages` schema & anti-spoofing RLS | Ticket-scoped schema; participants and admins only; sender anti-spoofing; recipient-only read updates | **PASS** |
| **P5.5-03** | Farmer revision request & tech note preservation | Farmer's original note preserved on repair; tech explanation stored in timeline | **PASS** |
| **P5.5-04** | Multi-version quote comparison helper | Computes item and price diffs across quote versions | **PASS** |
| **P5.5-05** | Repair messages service | Send, fetch, mark read, unread count executed cleanly with profile joins | **PASS** |
| **P5.5-06** | Invalid participant rejection | Cross-ticket send, empty messages, or tampering rejected by RLS | **PASS** |
| **P5.5-07** | `QUOTE_REVISED` action ownership | Models technician action required, farmer waiting; displays "Revision Requested" | **PASS** |
| **P5.5-08** | Technician Quote Revision UX | Previous Quote v1 card displayed; universal explanation input available | **PASS** |
| **P5.5-09** | Farmer Quote Revision Waiting State | Displays waiting card; previous quote details viewable; approval buttons suppressed | **PASS** |
| **P5.5-10** | `<QuoteComparison />` Component | Line-by-line diffs (+Added, -Removed, Modified), parts/labour diffs | **PASS** |
| **P5.5-11** | Farmer Revised Quote Review | Renders `<QuoteComparison />` and enables Approve/Decline actions for Quote v2 | **PASS** |
| **P5.5-12** | `<RepairChat />` Component | Real-time thread; recipient selection; max 2000 chars; role badges | **PASS** |
| **P5.5-13** | Admin Exception Copy Correction | Replaces legacy exception copy with "Quote revision requested by farmer · Tech response expected" | **PASS** |
| **P5.5-14** | Responsive UX & Build Verification | Responsive layout across mobile/desktop; clean production build with 0 errors | **PASS** |

---

## 8. Phase 5.6 Handover & Completion Verification Suite

| Test ID | Test Case | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P5.6-01** | E2E Completion Lifecycle | Advances through testing to `COMPLETED`; equipment restored to `Operational` | **PASS** |
| **P5.6-02** | Technician Sign-off Copy | CTA displays `"Complete & sign off"`; clarifies save to service history | **PASS** |
| **P5.6-03** | Admin Completion Notification | Admin receives: *"Repair TB-8841 completed & verified by technician. Ready for review."* | **PASS** |
| **P5.6-04** | Farmer Completion Notification & View | Farmer receives alert; repair hub displays *"Repair Complete & Saved to Service History"* | **PASS** |
| **P5.6-05** | Service History Creation & Idempotency | Immutable record created with invoice `INV-TB-8841`; exactly 1 record created | **PASS** |
| **P5.6-06** | Admin Dashboard Completed Filter | Completed repairs excluded from active queue; listed in dedicated Completed tab | **PASS** |
| **P5.6-07** | Admin Dashboard Cancelled Filter | Cancelled repairs excluded from active queue; listed in dedicated Cancelled tab | **PASS** |
| **P5.6-08** | Closed-State Controls on Admin Detail | Reassignment controls hidden; prominent Completion Details card displayed | **PASS** |
| **P5.6-09** | Farmer Testing Copy Refinement | Clarifies testing under load is final verification before saving to service history | **PASS** |
| **P5.6-10** | Demo Reset Baseline & Isolation | `TB-8841` restores to `WAITING_FOR_PARTS`; real user records untouched | **PASS** |

---

## 9. Phase 8 Logistics & Health Verification Matrix

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P8-01** | Health Auth Gate | Missing/invalid Bearer token returns HTTP 401 plain text without DB probe | **LOCAL PASS** |
| **P8-02** | Health Fail-Closed Config | Unset secret aliases return HTTP 500 plain text (`"Server configuration error"`) | **LOCAL PASS** |
| **P8-03** | Query Secret Rejection | `GET /api/health?secret=...` strictly rejected with HTTP 401 plain text | **LOCAL PASS** |
| **P8-04** | Response Sanitization | Authenticated response emits minimal sanitized JSON; zero raw database errors | **LOCAL PASS** |
| **P8-05** | Low-Privilege Probe | Validates public key; rejects `sb_secret_`; probes `profiles.id` with `limit(1)` | **LOCAL PASS** |
| **P8-06** | Decoupled Liveness HEAD | `HEAD /api/health` returns HTTP 200 without DB query or secret requirement | **LOCAL PASS** |
| **P8B.1-01**| Static Type Check & Build | 0 TypeScript errors (`tsc --noEmit`); clean Vite/Nitro production build | **AUTOMATED PASS** |
| **P8B.1-02**| Code Hygiene & Lint | Clean linting with zero whitespace or formatting errors | **AUTOMATED PASS** |
| **P8B.1-03**| Location & Coordinate Bounding | 14 official tahsils verified; coordinate bounds tested; Null Island rejected | **AUTOMATED PASS** |
| **P8B.1-06**| Dispatch Locations Migration | Table `public.repair_dispatch_locations` created with RLS; PostgREST returns 200 | **VERIFIED PASS** |
| **P8B.1-12**| OSRM Route Estimation Engine | Metric distance formatting, OSRM public service parser, 3-state GPS partition | **AUTOMATED PASS** |
| **P8B.1-13**| Ticket ID Resolution (`TB-7524`) | Handles both UUID and human-readable job number strings | **AUTOMATED PASS** |
| **P8B.1-14**| Demo Data Cleanup Verification | Validates 3 retained personas, clean seed baseline, candidate filter guard | **AUTOMATED PASS** |

---

## 10. Phase 9 Parts Desk, Movements & Sales Verification Suite

| Test ID | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **P9.1-01** | Database schema & constraints | `stock_quantity >= 0`, `quantity > 0`, location column, safeupdate WHERE clauses | **PASS** |
| **P9.1-02** | Strict RLS: Tech assignment & Farmer isolation | Farmers denied SELECT; technicians restricted to assigned repairs; admins full | **PASS** |
| **P9.1-03** | Five canonical demo parts | Exactly 5 canonical tractor parts (`0433171`, `005556958R1`, `AL120788`, etc.) | **PASS** |
| **P9.1-04** | Multi-field part search | Matches across tractor model, SKU, spec, category, and shelf location | **PASS** |
| **P9.1-05** | Deterministic stock restoration | Restores baseline stock (3, 8, 2, 5, 1); purges requisitions and stock audits | **PASS** |
| **P9.1-06** | Atomic handoff & audit log | Decrements stock atomically; records audit row; repeated handoffs blocked | **PASS** |
| **P9.1-07** | Farmer privacy quarantine | Farmer repair view never queries or renders depot stock counts or wholesale costs | **PASS** |
| **P9.2-01** | Stock movement ledger & returns | Stock increments on return/delivery; logs immutable `RECEIVED`/`RETURNED` movements | **PASS** |
| **P9.2-02** | Quote quantity caps | Requisitions against approved quotes capped at line quantity | **PASS** |
| **P9.2-03** | Repair location in Parts Desk | Displays linked repair location (`Katol, Nagpur`) distinguished from depot shelf | **PASS** |
| **P9.2-04** | Safeupdate compliance | Every DELETE statement contains explicit, non-trivial WHERE clause scoping to demo IDs | **PASS** |
| **P9.2-05** | Demo reset idempotency | Repeated resets execute cleanly without errors or schema drift | **PASS** |
| **P9.2-06** | Real user data preservation | Modal communicates demo scope; real user accounts and repairs immune | **PASS** |

---

## 11. Release Blocker Checklist

No phase promotion or production deployment may occur if:
1. Unauthenticated users can view or interact with `/farmer/*`, `/technician/*`, or `/admin/*`.
2. Unverified technicians can access the technician job workbench before administrator approval.
3. Non-admin users can elevate their role to `service_centre` or set `is_verified = true`.
4. Any client request can read or modify another user's private profile.
5. Farmer dashboards render mock data or cross-contaminate data across different farmers.
6. TypeScript errors (`tsc --noEmit`) or Vite build failures exist.
7. Secrets or credentials are committed in repository files, or health/telemetry probes bypass authentication or RLS.

---

*Testing analysis: 2026-11-04*
