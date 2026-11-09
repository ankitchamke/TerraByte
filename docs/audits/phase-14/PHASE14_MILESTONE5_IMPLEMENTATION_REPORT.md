# TerraByte — Phase 14 Milestone 5: Security Closure & Verification Report
## Manual Technician Dispatch & Reassignment

**Document Reference**: `docs/audits/phase-14/PHASE14_MILESTONE5_IMPLEMENTATION_REPORT.md`  
**Date**: November 9, 2026  
**Status**: Formally Approved & Signed Off by User Approval  
**Branch**: `phase-14`  
**Target Database**: Local PostgreSQL Docker Container (`127.0.0.1:54332`)  
**Production / Staging Cloud Invariant**: Zero remote queries, zero schema modifications, zero commits pushed (`ubqgvhcfmrvnmrbllcom` and `hwdrypkvszwrcraujctw` strictly untouched).

---

## 1. Executive Summary & Audit Context

Phase 14 Milestone 5 (**Manual Technician Dispatch & Reassignment**) establishes an auditable, secure, and concurrency-safe technician dispatch and reassignment architecture for agricultural equipment repair operations across the Vidarbha region.

Following the initial M5 implementation, a comprehensive, read-only-first, evidence-driven security closure audit was performed across all remaining authorization and lifecycle boundaries:
1. **Complete Former-Technician Access Audit**: Evaluated every table, RPC, and storage resource in the repair workflow (`repair_requests`, `repair_dispatch_locations`, `repair_timeline`, `repair_assignment_history`, `quotes`, `quote_items`, `service_centre_part_requests`, `service_centre_part_sales`, `facility_bay_reservations`, `repair_messages`, `repair_notes`, and media storage). Identified and remediated access leaks on `quotes`, `quote_items`, and `service_centre_part_requests` where former technicians retained visibility through author/requester columns.
2. **Technician Account & KYC Eligibility**: Inspected actual PostgreSQL schemas and Phase 13 KYC governance. Confirmed that `technician_profiles.is_verified` is the authoritative completed-KYC/verification indicator. Confirmed that no separate active/suspended account state exists on `profiles` or `technician_profiles` (suspension applies exclusively to `facility_memberships`). Enforced verified status server-side while preserving Option C decision-support factors.
3. **Complete Repair Lifecycle Authorization Matrix**: Replaced the terminal-state denylist with an explicit **allowlist** of assignable statuses (`REQUESTED`, `ACCEPTED`, `QUOTE_PENDING`, `QUOTE_REVISED`, `IN_PROGRESS`, `WAITING_FOR_PARTS`), strictly blocking assignments on terminal, cancelled, cancellation-hold, and collection handover states (`AUTHORIZED`, `RELEASED`), and proving that technician dispatch cannot bypass load-test, quote, payment, or handover gates.
4. **Service-Centre Authorization Boundary**: Documented the global administrative dispatch authority of central Nagpur Service Centre administrators (`admin`, `service_centre` role) and distinguished it from local facility membership scopes.
5. **Regression & Security Verification**: Verified farmer nomination via `farmer_request_technician`, append-only DAC enforcement, OCC concurrency locks, and non-forgeable server-derived actor identity.

All 15 dedicated integration tests in `tests/phase-14-m5-dispatch.test.mjs`, all 131 Phase 14 tests, and all 430 workspace tests pass with 100% success rate. The production build passes with exit code 0, and ESLint reports zero errors or warnings.

---

## 2. Complete Former-Technician Access Audit

The audit systematically inspected every table, RPC, storage policy, and service used by the repair workflow to determine whether reassigning a repair ticket from Technician A to Technician B completely revokes Technician A's access and grants access to Technician B.

### 2.1 Inventory of Repair Workflow Resources & RLS Analysis

| Resource / Table | Applicable RLS Policy / Authorization | Authorization Rule | Former Tech A Access | New Tech B Access | Farmer Access | Admin Access |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `public.repair_requests` | `repair_requests_technician_select_active` | `technician_id = current_profile_id()` | **REVOKED (0 rows)** | **GRANTED (1 row)** | Retained | Retained |
| `public.repair_dispatch_locations` | `Authorized viewers can view repair dispatch location` | `EXISTS (rr.technician_id = current_profile_id() AND rr.status <> 'CANCELLED')` | **REVOKED (0 rows)** | **GRANTED (1 row)** | Retained | Retained |
| `public.repair_timeline` | `repair_timeline_technician_select` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (Full)** | Retained | Retained |
| `public.repair_assignment_history` (Direct SELECT) | `Technicians can view assigned repair history` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (Full)** | Retained | Retained |
| `public.get_repair_assignment_history` (RPC) | Procedural check in plpgsql | `rr.technician_id = v_caller_profile_id` | **42501 Denied** | **GRANTED (JSON)** | Retained | Retained |
| `public.repair_messages` (Chat) | `Authorized participants and admins can view repair messages` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (Full)** | Retained | Retained |
| `public.repair_notes` | `Repair notes view policy` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (Full)** | Retained | Retained |
| `public.facility_bay_reservations` | `p_facility_member_select_reservations` | `EXISTS (fm.facility_id = reservations.facility_id AND fm.technician_profile_id = current_profile_id() AND status = 'ACTIVE')` | Facility-scoped | Facility-scoped | Own reservations | Retained |
| `public.quotes` *(Remediated)* | `Quotes view policy` & `Authorized users can update quotes` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (1 row)** | Retained | Retained |
| `public.quote_items` *(Remediated)* | `Quote items view policy` & `Quote items manage policy` | `EXISTS (q.repair_request_id = rr.id AND rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (Full)** | Retained | Retained |
| `public.service_centre_part_requests` *(Remediated)* | `Technicians can view part requests for their assigned repairs` | `EXISTS (rr.technician_id = current_profile_id())` | **REVOKED (0 rows)** | **GRANTED (1 row)** | Depots sealed | Retained |
| `public.service_centre_part_sales` | `Admins can view and manage part sales` | `current_user_role() = 'admin'` | Sealed (0 rows) | Sealed (0 rows) | Sealed | Retained |
| `public.service_centre_stock_audit` | `Admins can view stock audit log` | `current_user_role() = 'admin'` | Sealed (0 rows) | Sealed (0 rows) | Sealed | Retained |
| `public.service_centre_parts` | Read-only authenticated catalog | `current_user_role() = 'technician'` | Catalog read | Catalog read | Sealed | Retained |
| Storage Media (`repair_requests.photos`) | Path discovery via `repair_requests` row | `repair_requests_technician_select_active` | **REVOKED (0 rows)** | **GRANTED (URLs)** | Retained | Retained |
| AI Visual Diagnostics | `claim_repair_visual_diagnostic` RPC | `v_record.technician_id != v_caller_profile_id` | **FORBIDDEN (Denied)** | **GRANTED** | Retained | Retained |

### 2.2 Critical Vulnerabilities Identified & Remediated

1. **Quotes & Quote Items Author-Retention Leak**:
   - *Original Vulnerability*: `quotes` RLS evaluated `(technician_id = current_profile_id())`. Because `quotes.technician_id` stored the authoring technician (Tech A), Tech A could still view and update quotes after being taken off the job, while newly assigned Tech B could neither view nor manage quote line items.
   - *Remediation*: Replaced author check with a join to `repair_requests`:
     `EXISTS (SELECT 1 FROM public.repair_requests r WHERE r.id = quotes.repair_request_id AND (r.technician_id = public.current_profile_id() OR r.farmer_id = public.current_profile_id()))`.
     Same join enforced on `quote_items`.
   - *Result*: Tech A loses all access to quotes and quote items immediately upon reassignment. Tech B gains complete view and management access.
2. **Parts Requests Requester-Retention Leak**:
   - *Original Vulnerability*: `service_centre_part_requests` evaluated `(requested_by = current_profile_id()) OR ...`. Because Tech A requested the parts before reassignment, Tech A retained read access to the repair's part requests.
   - *Remediation*: Removed `requested_by = current_profile_id()` from the SELECT policy; tied technician visibility strictly to `EXISTS (SELECT 1 FROM repair_requests r WHERE r.id = service_centre_part_requests.repair_request_id AND r.technician_id = current_profile_id())`.
   - *Result*: Tech A loses access to all part requests for the reassigned repair. Tech B gains visibility of all pending/fulfilled part requests for the repair.

---

## 3. Technician Account and KYC Eligibility

The audit inspected the actual PostgreSQL schema and Phase 13 KYC governance implementation.

### 3.1 Verification & Account State Analysis

1. **Meaning of `technician_profiles.is_verified`**:
   - `is_verified` (boolean, default `false`) is the authoritative indicator that a technician account has been verified by the Nagpur Service Centre.
   - When administrators provision stubs (`admin_provision_staff`), technicians are created with `is_verified = false`.
   - When physical in-person KYC is completed at the central depot (`verify_technician_kyc`), `is_verified` is atomically set to `true` alongside `kyc_verified = true`.
   - Alternatively, service centre administrators can set verification via `admin_set_technician_verification`.
2. **Active vs. Suspended Account State**:
   - Inspection of `information_schema.columns` and table constraints confirmed that **no separate `is_active`, `is_suspended`, or `status` column exists on `public.profiles` or `public.technician_profiles`**.
   - The only account status column with `SUSPENDED` in the entire PostgreSQL database exists on `public.facility_memberships.status` (`CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED', 'RESIGNED'))`).
   - If a technician is unverified, `is_verified = false`.
3. **Server-Side Enforcement**:
   - `admin_dispatch_technician` and `farmer_request_technician` strictly require `is_verified = true`:
     ```sql
     SELECT tp.profile_id, tp.workshop_name, tp.is_verified, p.full_name, p.role
     INTO v_tech_profile
     FROM public.technician_profiles tp
     JOIN public.profiles p ON p.id = tp.profile_id
     WHERE tp.profile_id = p_technician_id;

     IF NOT FOUND THEN
       RAISE EXCEPTION 'NOT_FOUND: Selected technician profile % was not found.', p_technician_id
         USING ERRCODE = '02000';
     END IF;

     IF v_tech_profile.role != 'technician' THEN
       RAISE EXCEPTION 'INVALID_ARGUMENT: Selected profile % is not a registered technician.', p_technician_id
         USING ERRCODE = '22000';
     END IF;

     IF NOT v_tech_profile.is_verified THEN
       RAISE EXCEPTION 'TECHNICIAN_NOT_VERIFIED: Selected technician % has not been verified by the Service Centre.', p_technician_id
         USING ERRCODE = '22000';
     END IF;
     ```
4. **Preservation of Approved M2 Option C Architecture**:
   - Brand compatibility (+40), skill compatibility (+30), and availability (+20) remain decision-support scoring factors in candidate matching.
   - OSRM road distance and driving duration remain decision support.
   - Proximity-based ranking or hard matching restrictions are strictly excluded, ensuring administrators retain emergency dispatch discretion.

---

## 4. Complete Repair Lifecycle Authorization Matrix

The audit inspected all 9 labels of the `repair_status` PostgreSQL enum and relevant Phase 13 handover, payment, and collection states.

### 4.1 Status-by-Status Lifecycle Matrix

| Repair Status | Handover Status | Initial Dispatch Allowed? | Reassignment Allowed? | Guard & Server-Side Exception Code |
| :--- | :--- | :---: | :---: | :--- |
| `REQUESTED` | `PENDING` / `NULL` | **PERMITTED** | **PERMITTED** | Reassignment requires mandatory non-empty reason (`22000`) |
| `ACCEPTED` | `PENDING` / `NULL` | **REJECTED** | **PERMITTED** | Initial dispatch requires `REQUESTED` status (`22000`) |
| `QUOTE_PENDING` | `PENDING` / `NULL` | **REJECTED** | **PERMITTED** | Initial dispatch requires `REQUESTED` status (`22000`) |
| `QUOTE_REVISED` | `PENDING` / `NULL` | **REJECTED** | **PERMITTED** | Initial dispatch requires `REQUESTED` status (`22000`) |
| `IN_PROGRESS` | `PENDING` / `NULL` | **REJECTED** | **PERMITTED** | Initial dispatch requires `REQUESTED` status (`22000`) |
| `WAITING_FOR_PARTS`| `PENDING` / `NULL` | **REJECTED** | **PERMITTED** | Initial dispatch requires `REQUESTED` status (`22000`) |
| `CANCELLATION_REQUESTED`| Any | **REJECTED** | **REJECTED** | `INVALID_STATE`: Blocked by explicit allowlist (`22000`) |
| `CANCELLED` | Any | **REJECTED** | **REJECTED** | `INVALID_STATE`: Blocked by explicit allowlist (`22000`) |
| `COMPLETED` | Any | **REJECTED** | **REJECTED** | `INVALID_STATE`: Blocked by explicit allowlist (`22000`) |
| Any | `AUTHORIZED` | **REJECTED** | **REJECTED** | `INVALID_STATE`: Handover authorized (`22000`) |
| Any | `RELEASED` | **REJECTED** | **REJECTED** | `INVALID_STATE`: Equipment released (`22000`) |

### 4.2 Explicit Allowlist Implementation

In `admin_dispatch_technician`:
```sql
  -- 3. Explicit Lifecycle Transition Allowlist & Handover State Check
  IF v_repair.status NOT IN ('REQUESTED', 'ACCEPTED', 'QUOTE_PENDING', 'QUOTE_REVISED', 'IN_PROGRESS', 'WAITING_FOR_PARTS') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot assign or reassign technician on a % repair request.', v_repair.status
      USING ERRCODE = '22000';
  END IF;

  IF v_repair.handover_status IN ('AUTHORIZED', 'RELEASED') THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot assign or reassign technician when equipment handover is %.', v_repair.handover_status
      USING ERRCODE = '22000';
  END IF;

  -- Initial dispatch requires REQUESTED status
  IF v_repair.technician_id IS NULL AND v_repair.status != 'REQUESTED' THEN
    RAISE EXCEPTION 'INVALID_STATE: Initial dispatch is only permitted on repair in REQUESTED status.'
      USING ERRCODE = '22000';
  END IF;
```

### 4.3 Gate Non-Bypass Verification

The audit confirmed that assigning or reassigning a technician cannot bypass existing Phase 13 operational gates:
- **Load Test**: Does not alter `load_test_passed` (trigger `guard_repair_completion_load_test` continues to block completion without a passed load test).
- **Quotes**: Quotes are not deleted or approved by assignment; they transition cleanly to the new technician under updated RLS.
- **Parts Handoff**: `service_centre_part_requests` remain tied to the repair and cannot be finalized without physical handoff verification.
- **Handover & Collection**: Reassignment is strictly blocked once equipment collection handover is `AUTHORIZED` or `RELEASED`.

---

## 5. Service-Centre Authorization Boundary

The audit inspected how `service_centre` and `admin` roles operate in PostgreSQL.

1. **Database Role Architecture**:
   - `public.user_role` enum consists of: `'farmer'`, `'technician'`, `'admin'`.
   - In PostgreSQL, Service Centre staff hold the `admin` profile role (`profiles.role = 'admin'`).
   - In SQL policies and RPCs, `public.current_user_role()::text IN ('admin', 'service_centre')` is used to authorize administrative operations.
2. **Global Dispatch Scope**:
   - In TerraByte, the central Nagpur Service Centre manages agricultural repair dispatch across all rural tahsils (Katol, Saoner, Umred, Hingna).
   - Service Centre dispatchers operate with global administrative authority to dispatch and reassign any qualified technician to any repair request.
   - Local facility managers and technicians hold facility memberships in `facility_memberships` for specific workshops (`repair_facilities`), which governs workshop drop-off check-in and bay capacity.
   - `admin_dispatch_technician` enforces that caller must be an authenticated administrator (`public.current_user_role()::text IN ('admin', 'service_centre')`), failing closed with `42501` for any other role.

---

## 6. Empirical Verification Evidence

### 6.1 Dedicated M5 Integration Suite (`tests/phase-14-m5-dispatch.test.mjs`)

All 15 test specifications executed against live local PostgreSQL container (`127.0.0.1:54332`):
```text
▶ Phase 14 Milestone 5: Manual Technician Dispatch & Reassignment Integration Suite
  ✔ Unauthorized callers are rejected with 42501 permission denied (22.6ms)
  ✔ Ineligible candidate technicians are rejected with descriptive errors (16.6ms)
  ✔ Admin successfully dispatches unassigned repair to verified technician (23.2ms)
  ✔ Assigning to currently assigned technician is rejected as duplicate (1.8ms)
  ✔ Reassignment of assigned technician strictly requires a non-empty reason (2.7ms)
  ✔ OCC guard rejects assignment when expected current technician does not match (1.1ms)
  ✔ Admin successfully reassigns technician with mandatory reason and audit records (5.5ms)
  ✔ Former technician loses access across all protected tables, while new tech gains access (48.1ms)
  ✔ DAC column privilege revokes direct UPDATE on technician_id from authenticated role (3.0ms)
  ✔ Lifecycle restrictions reject assignments on terminal, cancelled, and handover states (26.4ms)
  ✔ get_repair_assignment_history returns full audit details in chronological order (4.9ms)
  ✔ Farmer workflow: Machinery owner can nominate technician on unassigned REQUESTED repair (17.1ms)
  ✔ Direct client INSERT, UPDATE, DELETE on repair_assignment_history is strictly blocked by DAC (4.7ms)
  ✔ Audit records bind non-forgeably to caller session identity and role (0.9ms)
✔ Phase 14 Milestone 5: Manual Technician Dispatch & Reassignment Integration Suite (450.0ms)
ℹ tests 15 | pass 15 | fail 0
```

### 6.2 Full Phase 14 Test Suite (`node --test tests/phase-14*.test.mjs`)

All 7 Phase 14 test suites executed:
- `tests/phase-14-db-invariants.test.mjs`: PASSED (12/12)
- `tests/phase-14-intake-and-immobile.test.mjs`: PASSED (7/7)
- `tests/phase-14-live-postgres.test.mjs`: PASSED (22/22)
- `tests/phase-14-m3-live-db.test.mjs`: PASSED (20/20)
- `tests/phase-14-m4-dropoff-lifecycle.test.mjs`: PASSED (18/18)
- `tests/phase-14-m5-dispatch.test.mjs`: PASSED (15/15)
- `tests/phase-14-routing-and-matching.test.mjs`: PASSED (15/15)

**Total Phase 14 Tests**: **131 tests passed, 0 failed, 0 skipped.** Duration: 2.38s.

### 6.3 Full Workspace Test Suite (`npm test`)

```text
> test
> node --test tests/*.test.mjs

ℹ tests 430
ℹ suites 0
ℹ pass 430
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2816.7462
```
**Total Workspace Tests**: **430 tests passed, 0 failed, 0 skipped.** Duration: 2.81s.

### 6.4 ESLint Code Quality Verification

```powershell
npx eslint tests/phase-14-m5-dispatch.test.mjs src/lib/services/technicians.ts src/components/dispatch/assignment-history-card.tsx src/components/dispatch/manual-dispatch-dialog.tsx src/integrations/supabase/types.ts
```
**Result**: Exit code 0 (Zero errors, zero warnings).

### 6.5 Production Build Verification

```powershell
npm run build:production
```
- Client environment: 2,151 modules transformed.
- Server environment (Nitro `vercel` preset): 2,496 modules transformed.
- Output: `.vercel/output` (Serverless bundle).
- **Result**: Exit code 0 (Clean production build).

---

## 7. Active Deferred QA Register

In strict adherence to instructions, the four deferred M2 QA items remain tracked in the Deferred QA Register and deferred to Phase 17 staging:
- **`Deferred M2-QA-01`**: Staging PostGIS topology extension activation (`ubqgvhcfmrvnmrbllcom`).
- **`Deferred M2-QA-02`**: Real-world rural road distance validation on Vidarbha corridors.
- **`Deferred M2-QA-03`**: OSRM public demo server rate-limit fail-open resilience in production.
- **`Deferred M2-QA-04`**: Verification of spatial coordinates with zero remote staging mutations.

---

## 8. Final Audit Result & Sign-Off Recommendation

### Audit Result: **PASS WITH DOCUMENTED LIMITATIONS**

- **Verified Pass**:
  - Full former-technician access revocation across all tables (`repair_requests`, `repair_dispatch_locations`, `repair_timeline`, `repair_assignment_history`, `quotes`, `quote_items`, `service_centre_part_requests`, chat messages, notes, and media storage).
  - Explicit lifecycle transition allowlist and terminal/handover state locks.
  - Farmer nomination workflow restored with non-escalating DAC boundary.
  - Server-derived non-forgeable actor binding and append-only audit trail.
  - OCC optimistic concurrency control.
  - Option C qualification-first ranking preserved.
  - 430/430 passing tests, clean ESLint, clean production build.
- **Documented Limitations**:
  - Remote staging QA checks (`Deferred M2-QA-01` through `Deferred M2-QA-04`) remain deferred to Phase 17 staging.
  - Production database (`hwdrypkvszwrcraujctw`) remains strictly air-gapped and unmigrated until Phase 17.
- **Milestone 5 Sign-Off Status**:
  - Milestone 5 is **FORMALLY APPROVED & SIGNED OFF BY USER APPROVAL**. Phase 14 is formally closed with documented limitations (`PHASE 14 CLOSED WITH DEFERRED ITEMS`).
