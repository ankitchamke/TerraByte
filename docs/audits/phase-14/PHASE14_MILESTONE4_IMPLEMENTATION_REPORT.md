# TerraByte Phase 14 Milestone 4 — Final Security Audit & Sign-Off Gate Report

**Document Date:** November 8, 2026  
**Phase:** Phase 14 — Smart Dispatch, Geolocation & Workshop Drop-Off  
**Milestone:** Milestone 4 (Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy)  
**Status:** Concurrency, Admin Integrity & Security Audit Complete — Awaiting User Formal Review (Milestone 4 Unsigned)  
**Target Branch:** `phase-14`  
**Test Database Container:** Local Docker PostgreSQL (`127.0.0.1:54332`)  
**Dedicated Staging Project:** `ubqgvhcfmrvnmrbllcom` (`ubqgvhcfmrvnmrbllcom.supabase.co` — Zero Remote Operations)  
**Production Project Target:** Phase 17 (`hwdrypkvszwrcraujctw` — Air-gapped and Untouched)  

---

## 1. Exact SQL Ownership and Authorization Findings

### Audit of `public.submit_workshop_dropoff_repair`
The SQL implementation was inspected and hardened via forward-only migration [`supabase/migrations/20261108220000_phase14_m4_submit_dropoff_hardening.sql`](file:///d:/Projects/TerraByte/supabase/migrations/20261108220000_phase14_m4_submit_dropoff_hardening.sql) to enforce all required database-level security invariants:

1. **Authentication & Identity Verification**:
   - `v_caller_profile_id := public.current_profile_id();`
   - If NULL, immediately aborts with `42501 UNAUTHORIZED: Authentication required.`.
2. **Caller Role Authorization**:
   - `v_caller_role := public.current_user_role()::text;`
   - Explicitly checks `IF v_caller_role NOT IN ('farmer', 'admin', 'service_centre') THEN RAISE EXCEPTION 'UNAUTHORIZED: Caller role % is not authorized to submit repair requests.', v_caller_role USING ERRCODE = '42501';`.
   - Ordinary technicians (`role = 'technician'`) are strictly denied with `42501 UNAUTHORIZED`.
3. **Farmer Profile ID Authorization (`p_farmer_id = current_profile_id()`)**:
   - If `v_caller_role = 'farmer'`, passing any `p_farmer_id` other than `v_caller_profile_id` aborts with `42501 UNAUTHORIZED: Farmer cannot submit a repair request for another farmer profile.`.
   - Farmer A cannot forge submissions on behalf of Farmer B.
4. **Equipment Existence & Ownership Verification**:
   - Validates `p_equipment_id` exists in `public.equipment`. If missing, raises `02000 NOT_FOUND`.
   - Validates `v_equipment.farmer_id = v_caller_profile_id` for farmer callers. If caller does not own the equipment, raises `42501 UNAUTHORIZED: Equipment does not belong to authenticated farmer.`.
   - Farmer A cannot submit using Farmer B's equipment.
5. **Equipment Eligibility & Conflicting Request Lock**:
   - Validates `v_equipment.status != 'In Repair'`. If already in repair, raises `22000 EQUIPMENT_IN_REPAIR`.
   - Checks `public.repair_requests` for active requests:
     ```sql
     PERFORM 1 FROM public.repair_requests
     WHERE equipment_id = p_equipment_id
       AND status NOT IN ('COMPLETED', 'CANCELLED');
     IF FOUND THEN
       RAISE EXCEPTION 'EQUIPMENT_IN_REPAIR: Equipment already has an active repair request in progress.'
         USING ERRCODE = '22000';
     END IF;
     ```
   - Prevents duplicate or conflicting active requests for the same tractor.
6. **Immobile Equipment Lock**:
   - If `p_is_immobile IS TRUE`, raises `22000 IMMOBILE_LOCK: Immobile machinery cannot use Workshop Drop-Off mode. Mode locked to DOORSTEP.`.
7. **Facility Status & Drop-Off Approval**:
   - Checks `repair_facilities` for existence, `is_active = TRUE`, and `drop_off_approved = TRUE`.
   - Inactive or unapproved workshops are rejected with `22000 FACILITY_UNAVAILABLE`.
8. **Request Field Validation**:
   - `p_location` must be non-null and non-empty.
   - `p_symptoms` (array) or `p_description` must be provided and non-empty.
   - If GPS coordinates are provided, validates `latitude BETWEEN -90 AND 90` and `longitude BETWEEN -180 AND 180`.
9. **Atomic Execution & Rollback**:
   - Inserts `repair_requests` row, updates `equipment.status = 'In Repair'`, and invokes `reserve_workshop_bay(v_repair_id, p_facility_id, INTERVAL '24 hours')`.
   - If `reserve_workshop_bay` rejects (e.g. `CAPACITY_EXHAUSTED`), raises exception and PostgreSQL rolls back the entire transaction.
   - Zero orphan repair requests, zero reservations, and zero equipment status mutations persist.
10. **Concurrency Serialization via `SELECT ... FOR UPDATE` on `public.equipment`**:
    - Migration [`supabase/migrations/20261108223000_phase14_m4_concurrency_and_admin_integrity.sql`](file:///d:/Projects/TerraByte/supabase/migrations/20261108223000_phase14_m4_concurrency_and_admin_integrity.sql) locks the equipment row immediately:
      ```sql
      SELECT id, farmer_id, status
      INTO v_equipment
      FROM public.equipment
      WHERE id = p_equipment_id
      FOR UPDATE;
      ```
    - When two transactions attempt to submit drop-off repairs for the same equipment concurrently, the second transaction is blocked on the row lock until the first commits.
    - Upon unblocking, the second transaction evaluates `v_equipment.status = 'In Repair'` and aborts with `22000 EQUIPMENT_IN_REPAIR`.
    - The hierarchical lock ordering (`equipment` -> `repair_facilities` -> `repair_requests` -> `facility_bay_reservations`) guarantees complete deadlock freedom.
11. **Admin/Service-Centre Ownership Consistency Enforcement**:
    - For admin or service_centre callers submitting on behalf of a farmer, `p_farmer_id` is reconciled with `v_equipment.farmer_id`:
      ```sql
      IF p_farmer_id IS NOT NULL AND p_farmer_id != v_equipment.farmer_id THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Equipment owner does not match specified farmer profile.'
          USING ERRCODE = '22000';
      END IF;
      v_effective_farmer_id := v_equipment.farmer_id;
      ```
    - Prevents administrators or service centres from accidentally or maliciously assigning Farmer A's equipment to Farmer B's profile.
    - If `p_farmer_id` is omitted, defaults directly to `v_equipment.farmer_id`.

---

## 2. RPC Authorization Matrix with Verification Test Names

| RPC | Authorized Roles | Ownership / Facility Membership Condition | Database Enforcement | Audit Fields Required | Rejection Code & Behavior | Test Suite & Test Name |
| :--- | :--- | :--- | :---: | :--- | :---: | :--- |
| `submit_workshop_dropoff_repair` | `farmer`, `admin`, `service_centre` | Farmer owns `p_equipment_id`; `p_farmer_id = caller`; facility approved; admin ownership parity; equipment row lock (`FOR UPDATE`) | **YES (PostgreSQL)** | Timeline insert, sequence job number | `42501` / `22000` (Transaction aborts) | `phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Negative Security: submit_workshop_dropoff_repair enforces role...`<br>• `Atomicity: submit_workshop_dropoff_repair on full workshop aborts...`<br>• `Concurrency: Concurrent duplicate drop-off submissions on same equipment serialize and reject conflict`<br>• `Admin Integrity: submit_workshop_dropoff_repair enforces farmer ownership consistency for admin callers` |
| `reserve_workshop_bay` | `farmer`, `admin`, `service_centre` | Farmer owns ticket (`farmer_id = caller`) or Admin | **YES (PostgreSQL)** | `repair_timeline` record | `42501 UNAUTHORIZED` | `phase-14-live-postgres.test.mjs` (line 460)<br>`phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Rerouting preserves original reserved_at FIFO priority timestamp` (checks 3 & 4) |
| `renew_workshop_bay_reservation` | `farmer` (1x self), `admin` (override) | Farmer owns reservation (`farmer_profile_id = caller`); Admin any | **YES (PostgreSQL)** | `p_notes` mandatory for Admin (`renewal_notes`) | `42501 UNAUTHORIZED` / `22000 RENEWAL_LIMIT_EXCEEDED` / `22000 AUDIT_NOTES_REQUIRED` | `phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Farmer is limited to 1x self-renewal; Admin requires audit notes` (checks 1–6) |
| `release_workshop_bay_reservation` | `farmer` (own), Admin, Facility Member | `farmer_profile_id = caller` OR active member at facility OR Admin | **YES (PostgreSQL)** | `p_reason` logged in `repair_timeline` | `42501 UNAUTHORIZED` | `phase-14-live-postgres.test.mjs` (line 620)<br>`phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Cancelled ticket physically occupying bay holds occupancy...` (check 3B) |
| `execute_workshop_dropoff_checkin` | Admin, Facility `OWNER` / `MANAGER` | Active member with `role IN ('OWNER', 'MANAGER')` at facility; Technicians & Farmers denied | **YES (PostgreSQL)** | `p_notes` logged, formatted receipt generated | `42501 UNAUTHORIZED` | `phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Authorization Matrix: Manager can check-in at own facility; denied at foreign facility; farmer & tech denied` |
| `release_cancelled_workshop_equipment` | Admin, Facility `OWNER` / `MANAGER` | Active member with `role IN ('OWNER', 'MANAGER')` at facility; Technicians & Farmers denied | **YES (PostgreSQL)** | `p_notes` logged, `handover_released_at` set | `42501 UNAUTHORIZED` / `22000 PRECONDITION_FAILED` (non-cancelled rejected) | `phase-14-m4-dropoff-lifecycle.test.mjs`<br>• `Cancelled ticket physically occupying bay holds occupancy until authorized physical release` |

---

## 3. New Migration Details

### Migration 1: `supabase/migrations/20261108220000_phase14_m4_submit_dropoff_hardening.sql`
- **Purpose**: Forward-only security hardening for `public.submit_workshop_dropoff_repair`.
- **Changes**:
  1. Drops legacy 10-parameter signature `submit_workshop_dropoff_repair(UUID, UUID, TEXT[], TEXT, TEXT, TEXT[], JSONB, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)` to prevent function overload ambiguity.
  2. Implements 12-parameter signature with optional `p_farmer_id UUID DEFAULT NULL` and `p_is_immobile BOOLEAN DEFAULT FALSE`.
  3. Enforces caller role must be `farmer`, `admin`, or `service_centre`.
  4. Enforces farmer identity parity (`p_farmer_id = v_caller_profile_id`).
  5. Enforces equipment ownership (`v_equipment.farmer_id = v_caller_profile_id`).
  6. Enforces equipment eligibility (`status != 'In Repair'` and zero existing active tickets).
  7. Enforces facility status (`is_active = TRUE AND drop_off_approved = TRUE`).
  8. Enforces mobility lock (`p_is_immobile IS FALSE`).
  9. Validates all input fields before insertion.
  10. Atomically calls `public.reserve_workshop_bay(v_repair_id, p_facility_id, INTERVAL '24 hours')` and rolls back on failure.
  11. Hardened with `SET search_path = ''`, full schema qualification, and least-privilege grants (`REVOKE ALL FROM PUBLIC`, `REVOKE FROM anon`, `GRANT TO authenticated, service_role`).
- **Application**: Applied to local test container `127.0.0.1:54332`. Staging and production databases were untouched.

### Migration 2: `supabase/migrations/20261108223000_phase14_m4_concurrency_and_admin_integrity.sql`
- **Purpose**: Concurrency serialization via equipment row-locking and admin/service-centre ownership consistency enforcement.
- **Changes**:
  1. Serializes concurrent submissions for the same equipment by executing `SELECT id, farmer_id, status INTO v_equipment FROM public.equipment WHERE id = p_equipment_id FOR UPDATE;` before status checks, active request checks, and insertion.
  2. Reconciles caller role and farmer ownership: if an admin or service_centre caller supplies `p_farmer_id`, it MUST match `v_equipment.farmer_id`; any mismatch raises `22000 INVALID_ARGUMENT: Equipment owner does not match specified farmer profile.`.
  3. Guarantees `v_effective_farmer_id := v_equipment.farmer_id;` always binds the verified true equipment owner into the repair request record.
  4. Follows strict lock acquisition order (`equipment` -> `repair_facilities` -> `repair_requests` -> `facility_bay_reservations`) ensuring complete deadlock immunity.
- **Application**: Applied to local test container `127.0.0.1:54332`. Staging and production databases were untouched.

---

## 4. Negative Authorization Test Results

Executed via [`tests/phase-14-m4-dropoff-lifecycle.test.mjs`](file:///d:/Projects/TerraByte/tests/phase-14-m4-dropoff-lifecycle.test.mjs):

```text
▶ Phase 14 Milestone 4: Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy
  ✔ Negative Security: submit_workshop_dropoff_repair enforces role, profile identity, equipment ownership, and facility status (13.148ms)
      - Farmer 1 submitting using Farmer 2 profile ID -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Farmer 1 submitting using Farmer 2 equipment ID -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Ordinary technician submitting repair request -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Submission referencing unapproved facility -> REJECTED (22000 FACILITY_UNAVAILABLE) [PASS]
      - Immobile machinery submission to Workshop Drop-Off -> REJECTED (22000 IMMOBILE_LOCK) [PASS]
  ✔ Atomicity: submit_workshop_dropoff_repair on full workshop aborts and leaves ZERO orphan tickets (26.0561ms)
      - Capacity exhaustion raises error and asserts 0 repair requests and 0 equipment status mutations [PASS]
  ✔ Authorization Matrix: Manager can check-in at own facility; denied at foreign facility; farmer & tech denied (20.7045ms)
      - Manager Alpha checking in at Facility Beta -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Farmer attempting physical check-in -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Ordinary Technician attempting physical check-in -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Manager Beta checking in at Facility Beta -> SUCCEEDS [PASS]
  ✔ Rerouting preserves original reserved_at FIFO priority timestamp (18.553ms)
      - Ordinary Technician attempting to reroute -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Foreign Farmer attempting to reroute -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Admin reroute preserves original priority timestamp [PASS]
  ✔ Farmer is limited to 1x self-renewal; Admin requires audit notes (16.8795ms)
      - Farmer 1st self-renewal -> SUCCEEDS [PASS]
      - Farmer 2nd self-renewal -> REJECTED (22000 RENEWAL_LIMIT_EXCEEDED) [PASS]
      - Admin renewal with empty audit notes -> REJECTED (22000 AUDIT_NOTES_REQUIRED) [PASS]
      - Admin renewal with audit notes -> SUCCEEDS [PASS]
      - Farmer 2 attempting to renew Farmer 1's reservation -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Farmer 1 attempting staff renewal override with notes -> REJECTED (22000 RENEWAL_LIMIT_EXCEEDED) [PASS]
  ✔ Cancelled ticket physically occupying bay holds occupancy until authorized physical release (18.5976ms)
      - Farmer attempting physical release -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Ordinary Technician attempting physical release -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Foreign Manager Beta attempting physical release at Alpha -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Foreign Manager Beta attempting reservation release at Alpha -> REJECTED (42501 UNAUTHORIZED) [PASS]
      - Authorized Manager Alpha executes physical release -> SUCCEEDS and decrements bay occupancy [PASS]
  ✔ Facility-level data isolation: RLS strictly partitions reservations across facilities and farmers (4.7217ms)
      - Manager Alpha queries reservations -> ONLY sees Facility Alpha rows [PASS]
      - Farmer 1 queries reservations -> ONLY sees Farmer 1 rows [PASS]
      - Farmer 2 queries Farmer 1's checked-in repair request for receipt -> 0 rows returned under RLS [PASS]
  ✔ Concurrency: Concurrent duplicate drop-off submissions on same equipment serialize and reject conflict (44.396ms)
      - Client A & Client B initiate concurrent submit_workshop_dropoff_repair calls on identical tractor
      - Client A acquires equipment row lock FOR UPDATE and successfully inserts repair request + bay reservation [PASS]
      - Client B unblocks, detects equipment status = 'In Repair', and raises 22000 EQUIPMENT_IN_REPAIR [PASS]
      - Database verifies exactly 1 active repair request, exactly 1 active bay reservation, and consistent equipment status [PASS]
  ✔ Admin Integrity: submit_workshop_dropoff_repair enforces farmer ownership consistency for admin callers (10.1616ms)
      - Admin caller passing Farmer A profile ID with Farmer B's equipment -> REJECTED (22000 INVALID_ARGUMENT) [PASS]
      - Admin caller passing matching Farmer A profile ID with Farmer A's equipment -> SUCCEEDS [PASS]
      - Admin caller with omitted p_farmer_id -> SUCCEEDS and binds true owner v_equipment.farmer_id [PASS]
```

---

## 5. Complete Changed-File ESLint Results

### 1. Fully Clean Milestone 4 Files (12 Files — Exit Code 0, 0 Errors, 0 Warnings)
Command:
```powershell
npx eslint "src/components/facilities/custody-receipt-modal.tsx" "src/components/facilities/workshop-admin-dialogs.tsx" "src/components/facilities/workshop-checkin-dialog.tsx" "src/components/facilities/workshop-operations-desk.tsx" "src/lib/services/facility-capacity.ts" "src/lib/services/facilities.ts" "src/routes/farmer/report-breakdown.tsx" "src/lib/i18n/dictionaries/en.ts" "src/lib/i18n/dictionaries/hi.ts" "src/lib/i18n/dictionaries/mr.ts" "tests/phase-14-m4-dropoff-lifecycle.test.mjs" "tests/phase-13-milestone6-integration-e2e.test.mjs"
```

Result:
```text
Exit code: 0
Output: (clean — 0 errors, 0 warnings across all 12 files)
```

### 2. Pre-Existing Legacy Route Files Audit & Exception Analysis

Every created or modified file was audited for newly introduced lint errors vs. pre-existing legacy issues:

#### A. `src/routes/admin/facilities.tsx` (1 Pre-Existing Legacy Error)
- **Error**: `121:17 error Unexpected any. Specify a different type @typescript-eslint/no-explicit-any`
- **Origin**: Introduced in Phase 13 Milestone 5 (`TEST-13-W05`) to permit both `admin` and `service_centre` role access.
- **Why Required by Phase 13 Test**: `tests/phase-13-workshop-management.test.mjs` line 383 contains an exact static source assertion:
  ```js
  assert.match(
    content,
    /profile\.role\s*!==\s*"admin"\s*&&\s*\(profile\s+as\s+any\)\.role\s*!==\s*"service_centre"/,
    "Must check admin / service_centre authorization"
  );
  ```
- **Type-Safety Evaluation**: Replacing `(profile as any)` with a type-safe narrowing or comment would alter the code tested by Phase 13 and break the `\s*` whitespace regex match in `TEST-13-W05`.
- **Verdict**: Legitimate pre-existing Phase 13 test dependency. Preserved without altering Phase 13 behavior.

#### B. `src/routes/farmer/repair/$id.tsx` (28 Pre-Existing Legacy Errors)
- **Errors**: 28 pre-existing `no-explicit-any` errors from Phase 11/12 (e.g. lines 229, 250, 410, 440, 504, 557, 598, 616, 667, 1040, 1101, 1560, 1606).
- **Milestone 4 Additions**:
  - State: `facilityDetail` and `reservationDetail` are strictly typed (`{ id: string; ... } | null`).
  - Handlers: `handleFarmerRenewReservation` uses safe `catch (err: unknown)` with `err instanceof Error`.
  - UI: `CustodyReceiptModal` uses typed contract `CustodyReceiptData`.
  - Active reservation card, renewal trigger, and cancelled custody banner are 100% strictly typed.
- **Verdict**: **Zero** errors introduced by Milestone 4.

#### C. `src/routes/admin/repair/$id.tsx` (27 Pre-Existing Legacy Errors, 1 Warning)
- **Errors**: 27 pre-existing `no-explicit-any` errors and 1 pre-existing `useCallback` dependency warning from Phase 11/12.
- **Milestone 4 Additions**:
  - Dialog components (`WorkshopCheckinDialog`, `ExtendReservationDialog`, `RerouteWorkshopDialog`, `ReleaseEquipmentDialog`, `CustodyReceiptModal`) are fully typed.
  - Drop-off cards and in-bay banners contain zero untyped expressions.
- **Verdict**: **Zero** errors introduced by Milestone 4.

#### D. `src/routes/technician/job/$id.tsx` (53 Pre-Existing Legacy Errors, 1 Warning)
- **Errors**: 50 pre-existing `no-explicit-any` errors and 1 pre-existing `useEffect` dependency warning from Phase 11/12.
- **Prettier Code-Style Constraints**:
  - Line 1472: `className={cn(input, "h-10 min-h-[2.5rem] py-1.5 px-3 text-xs leading-normal cursor-pointer")}` is an exact single-line string required by Phase 12 test assertion `tests/parts-desk.test.mjs:1523`.
  - Line 829: `Quote v{pendingQuote.version} (Pending Farmer Review)` is an exact single-line string required by Phase 12 test assertion `tests/parts-desk.test.mjs:960`.
  - Reformatting these breaks the test suite assertions in `tests/parts-desk.test.mjs`.
- **Milestone 4 Additions**:
  - `Building2`, `AlertTriangle`, `CheckCircle2` imports.
  - Workshop drop-off delivery badge and custody status pill.
  - Cancelled equipment in workshop bay banner.
- **Verdict**: **Zero** errors introduced by Milestone 4.

---

## 6. PostgreSQL Integration Results

### 1. Phase 14 Test Suites (`node --test tests/phase-14*.test.mjs`)
- **Total Tests**: 116
- **Passed**: 116
- **Failed**: 0
- **Suites**:
  - `tests/phase-14-smart-dispatch.test.mjs`: 21/21 passed
  - `tests/phase-14-intake-and-immobile.test.mjs`: 7/7 passed
  - `tests/phase-14-live-postgres.test.mjs`: 22/22 passed
  - `tests/phase-14-intake-database-security.test.mjs`: 18/18 passed
  - `tests/phase-14-m4-dropoff-lifecycle.test.mjs`: 18/18 passed (including concurrency & admin integrity tests)
  - `tests/phase-14-route-resilience.test.mjs`: 15/15 passed
  - `tests/phase-14-ranking-determinism.test.mjs`: 15/15 passed
- **Total Duration**: 1,797 ms

### 2. Relevant Phase 13 Regression Test Suites (`node --test tests/phase-13*.test.mjs`)
- **Total Tests**: 128
- **Passed**: 128
- **Failed**: 0
- **Duration**: 367 ms

---

## 7. Full Workspace Test and Production Build Results

### 1. Workspace Test Suite (`npm test`)
```powershell
npm test
```
Result:
```text
ℹ tests 415
ℹ suites 0
ℹ pass 415
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2278.811
Exit code: 0
```

### 2. Production Build (`npm run build:production`)
```powershell
npm run build:production
```
Result:
```text
[nitro:vercel] i Using nodejs24.x runtime.
[nitro:vercel] i Using web entry format.
vite v8.1.5 building client environment for production...
transforming...✓ 2149 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 2.54s

[nitro] o Building [Nitro] (preset: vercel, compatibility: 2026-11-08)
[nitro] √ Generated public .vercel/output/static
vite v8.1.5 building nitro environment for production...
transforming...✓ 2496 modules transformed.
rendering chunks...
✓ built in 1.25s
i Generated .vercel/output/nitro.json
[nitro] √ You can preview this build using npx vite preview
[nitro] √ You can deploy this build using npx nitro deploy --prebuilt
Exit code: 0
```

---

## 8. Remaining Limitations and Deferred Items

The four Deferred Milestone 2 QA items remain tracked, active, and deferred until live staging repair jobs exist:

| Item Identifier | Scope | Status | Reason for Deferral |
| :--- | :--- | :---: | :--- |
| **Deferred M2-QA-01** | Farmer Candidate List & Routing Card | **DEFERRED / ACTIVE** | Blocked on zero active staging repair tickets for farmer |
| **Deferred M2-QA-02** | Technician Job Detail & Road Estimate Card | **DEFERRED / ACTIVE** | Blocked on zero assigned staging repair jobs for technician |
| **Deferred M2-QA-03** | OSRM Outage Resilience & Qualification Protection | **DEFERRED / ACTIVE** | Blocked on zero candidate list or active route card in staging |
| **Deferred M2-QA-04** | Haversine Banning & DB Isolation Regression Check | **DEFERRED / ACTIVE** | Gated on live staging manual testing pass |

**Register Status**: 4 Active / 0 Completed / 0 Deleted.

---

## 9. Exact Created and Modified Files

### Created Files (7 files)
1. `supabase/migrations/20261108210000_phase14_m4_atomic_dropoff_reservation.sql` (Initial atomic drop-off migration)
2. `supabase/migrations/20261108220000_phase14_m4_submit_dropoff_hardening.sql` (Security & ownership hardening forward migration)
3. `supabase/migrations/20261108223000_phase14_m4_concurrency_and_admin_integrity.sql` (Equipment FOR UPDATE lock & admin ownership consistency forward migration)
4. `src/components/facilities/` (4 UI components: `custody-receipt-modal.tsx`, `workshop-admin-dialogs.tsx`, `workshop-checkin-dialog.tsx`, `workshop-operations-desk.tsx`)
5. `src/lib/services/facility-capacity.ts` (Capacity, reservation, and drop-off service layer)
6. `tests/phase-14-m4-dropoff-lifecycle.test.mjs` (18-test comprehensive PostgreSQL integration suite)
7. `scratch/phase-14/apply_m4_remediation_migration.mjs` (Scratch helper in `scratch/phase-14/`)

### Modified Files (12 files)
1. `src/routes/farmer/report-breakdown.tsx` (Atomic drop-off submission integration)
2. `src/routes/admin/facilities.tsx` (Operations Desk launcher integration)
3. `src/routes/admin/repair/$id.tsx` (Workshop drop-off cards, dialogs, and receipt modal)
4. `src/routes/farmer/repair/$id.tsx` (Active reservation countdown, 1x renewal, receipt trigger)
5. `src/routes/technician/job/$id.tsx` (Drop-off badge, receipt reference, cancelled custody banner)
6. `src/lib/i18n/dictionaries/en.ts` (10 Phase 14 M4 localization strings)
7. `src/lib/i18n/dictionaries/hi.ts` (10 Phase 14 M4 Hindi translations)
8. `src/lib/i18n/dictionaries/mr.ts` (10 Phase 14 M4 Marathi translations)
9. `.planning/ROADMAP.md` (Synchronized milestone status)
10. `.planning/STATE.md` (Synchronized active progress)
11. `docs/audits/phase-14/PHASE14_IMPLEMENTATION_PLAN.md` (Deliverables and test criteria)
12. `tests/phase-13-milestone6-integration-e2e.test.mjs` (Preserved dictionary key count assertions for 270 keys)

### Deleted Files
*Zero files deleted.*

---

## 10. Confirmation of Zero Remote DB and Git Operations

1. **Zero Remote Database Operations**:
   - Staging (`ubqgvhcfmrvnmrbllcom` / `ubqgvhcfmrvnmrbllcom.supabase.co`): Zero queries, zero mutations, zero network requests.
   - Production (`hwdrypkvszwrcraujctw`): Completely untouched. Production deployment remains locked to Phase 17.
2. **Zero Git Mutations**:
   - Zero `git commit`, `git push`, `git rebase`, `git stash`, or `git checkout` commands executed.
   - Working directory remains on branch `phase-14` with unstaged changes intact.
3. **Repository Directory Layout Enforcement**:
   - All reports in `docs/audits/phase-14/`.
   - All scratch scripts in `scratch/phase-14/`.
   - All tests in `tests/`.
   - Zero files created in repository root.

---

## 11. Sign-Off Readiness Assessment

Phase 14 Milestone 4 has satisfied all technical, architectural, and security prerequisites:
- Database-level ownership verification guarantees that farmers cannot forge profile IDs or equipment IDs.
- Concurrency serialization via `SELECT ... FOR UPDATE` eliminates race conditions on duplicate submissions.
- Admin ownership consistency prevents cross-profile equipment association.
- Ordinary technicians and foreign workshop managers are strictly prevented from executing physical check-in or physical release.
- Bay reservation failure rolls back the entire submission atomically, preventing orphan tickets.
- Receipts and reservations are private under Row Level Security.
- 116/116 Phase 14 tests, 128/128 Phase 13 tests, and 415/415 full test suite pass.
- Production build passes with exit code 0.
- All 4 deferred M2 QA items remain active.

Milestone 4 is **genuinely ready for formal user review and sign-off**. Milestone 5 has not been started.
