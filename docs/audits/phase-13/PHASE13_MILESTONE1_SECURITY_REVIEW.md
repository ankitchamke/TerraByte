# TerraByte Phase 13 — Milestone 1 Independent Migration Security & Correctness Review

**Review Date**: 2026-11-06  
**Review Type**: Independent Read-Only Security & Correctness Review  
**Target Migration**: [20261106160000_phase13_database_foundations.sql](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql)  
**Test Suite**: [phase-13-db-invariants.test.mjs](file:///d:/Projects/TerraByte/tests/phase-13-db-invariants.test.mjs)  
**Implementation Report**: [PHASE13_MILESTONE1_IMPLEMENTATION_REPORT.md](file:///d:/Projects/TerraByte/docs/audits/phase-13/PHASE13_MILESTONE1_IMPLEMENTATION_REPORT.md)  
**Source Specification**: [PHASE13_IMPLEMENTATION_PLAN.md](file:///d:/Projects/TerraByte/docs/audits/phase-13/PHASE13_IMPLEMENTATION_PLAN.md)

---

## 1. Executive Summary & Review Verdict

An independent, read-only architectural and security review was conducted on the Phase 13 Milestone 1 database foundations. The review analyzed the complete 1,995 lines of SQL, 15 stored procedures (RPCs), 8 invariant triggers, Discretionary Access Control (DAC) grants, Row-Level Security (RLS) policies, and the accompanying test suite against the live repository schema and previous migration history.

### Overall Verdict

**`APPROVED WITH CONDITIONS`**

The core relational architecture, single-owner workshop model, invariant triggers, and hardened RPCs are substantially robust, well-parameterized (`SET search_path = ''`), and conformant with TerraByte's decoupled identity architecture (`public.current_profile_id()`). However, **two CRITICAL** and **two HIGH** security and operational defects were identified that must be resolved prior to applying this migration to any staging or production database:

1. **CRITICAL**: Missing direct mutation protection on `public.technician_profiles` allows authenticated technicians to bypass KYC and skill verification by directly issuing SQL `UPDATE` statements on `verified_skills`, `kyc_verified`, and `rating`.
2. **CRITICAL**: `public.reset_demo_data()` drops the Phase 9.1–9.3 and Phase 12 parts desk restoration, orphan sales cleanup, and equipment-scoped repair resolution, causing state drift in staging.
3. **HIGH**: Unpartitioned `SELECT` grants on `public.technician_profiles` leak confidential `kyc_remarks`, `kyc_masked_id`, and private `ai_suggested_skills` to anonymous and public authenticated callers.
4. **HIGH**: Base-table column-level `REVOKE SELECT` on `public.repair_facilities` completely blocks workshop owners and managers from reading their own facility's address, phone, and capacity via standard client queries without a dedicated profile RPC.

---

## 2. SQL Migration Review

### 2.1 SQL Syntax & Migration Execution Ordering
- **Overall Syntax**: The migration contains valid PostgreSQL 15+ PL/pgSQL syntax.
- **Execution Order**:
  1. Altering existing tables (`technician_profiles`, `repair_requests`, `service_history`) precedes table creation.
  2. Table creation (`repair_facilities`, `facility_memberships`, `technician_reviews`) precedes index creation and foreign key constraints.
  3. Foreign keys referencing `repair_facilities` (`technician_profiles.primary_facility_id`, `repair_requests.facility_id`, `service_history.facility_id`) are applied strictly after `repair_facilities` is created.
  4. Functions and triggers are created before DAC grants and RLS policies.
  This dependency hierarchy executes cleanly without circular dependency errors.

### 2.2 Existing Schema Compatibility & Catalog Object Resolution
- **User Roles Enum**: The migration properly respects `public.user_role` (`'farmer'`, `'technician'`, `'admin'`). In PL/pgSQL routines, callers compare `v_role_text IN ('admin', 'service_centre')` or cast to `::text` to avoid PostgreSQL enum cast errors while honoring business logic.
- **Foreign Keys**:
  - `repair_facilities.owner_profile_id` references `public.profiles(id) ON DELETE RESTRICT`.
  - `facility_memberships.technician_profile_id` references `public.profiles(id) ON DELETE CASCADE`.
  - `service_history.repair_request_id` and `service_history.equipment_id` are modified to `ON DELETE RESTRICT`.
- **Pre-existing Constraint Naming**: In `public.technician_profiles`, inline constraint `CHECK (rating >= 0 AND rating <= 5)` from [20260930000001_initial_schema.sql](file:///d:/Projects/TerraByte/supabase/migrations/20260930000001_initial_schema.sql#L96) is replaced using `DROP CONSTRAINT IF EXISTS technician_profiles_rating_check`.

### 2.3 Foreign Key Definitions & Deletion Behavior
- **Hardening on `service_history`**: Changing `repair_request_id` and `equipment_id` foreign keys to `ON DELETE RESTRICT` successfully prevents indirect cascading deletion of completed service histories when repairs or equipment are deleted.
- **Impact on Existing Data**:
  If a database contains historical `service_history` records where `repair_request_id` was set to `NULL` (due to prior `ON DELETE SET NULL`), the new `FOREIGN KEY ... ON DELETE RESTRICT` validates cleanly because PostgreSQL allows `NULL` values in foreign keys.
  However, any direct SQL `DELETE FROM repair_requests` or `DELETE FROM equipment` will henceforth be blocked if service history records exist.

### 2.4 Trigger Execution Order & Recursion Safety
- **Ownership Transfer & Membership Triggers**:
  - Updating `repair_facilities.owner_profile_id` fires `trg_facility_ownership_transfer` (`AFTER UPDATE OF owner_profile_id`).
  - This trigger updates `facility_memberships` (demoting old owner to `MANAGER` and promoting new owner to `OWNER`).
  - This in turn fires `trg_guard_owner_membership_mutation` (`BEFORE UPDATE ON facility_memberships`).
  - Because `trg_facility_ownership_transfer` is an `AFTER UPDATE` trigger, `repair_facilities.owner_profile_id` has already been updated in the catalog. Therefore, `guard_owner_membership_mutation` evaluates against the new owner ID, verifying that the new owner matches and avoiding false-positive demotion blocks.
  - Zero trigger recursion risk exists because `facility_memberships` triggers do not update `repair_facilities`.

### 2.5 Concurrency & Transaction Safety
- **Technician Rating Recalculation**:
  `trg_recalculate_technician_rating` executes `PERFORM profile_id FROM public.technician_profiles WHERE profile_id = v_tech FOR UPDATE`.
  When a review is reassigned between two technicians, it orders row locks deterministically using `least()` and `greatest()`, eliminating ABBA deadlock vulnerabilities during high-concurrency review submissions.

---

## 3. RPC Security Review (All 15 RPCs)

Every RPC was evaluated against:
1. Appropriateness of `SECURITY DEFINER` vs `SECURITY INVOKER`.
2. Mandatory `SET search_path = ''` to prevent search-path hijack.
3. Strict schema qualification of all catalog objects.
4. Identity resolution via `public.current_profile_id()` and `public.current_user_role()`.
5. Explicit privilege revokes from `PUBLIC` and `anon`.

| RPC Name | Mode | `search_path` | Caller Identity Check | Authorization Gate | Review Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `transfer_facility_ownership` | DEFINER | `''` | `current_profile_id()` | Current owner or Service Centre admin only | **SECURE** |
| `invite_technician_to_facility` | DEFINER | `''` | `current_profile_id()` | Facility OWNER/MANAGER or admin; targets by 10-digit phone | **SECURE** |
| `accept_facility_invitation` | DEFINER | `''` | `current_profile_id()` | Only invited technician; 14-day expiration check | **SECURE** |
| `reject_facility_invitation` | DEFINER | `''` | `current_profile_id()` | Only invited technician; status must be `INVITED` | **SECURE** |
| `revoke_facility_invitation` | DEFINER | `''` | `current_profile_id()` | Facility OWNER/MANAGER or admin | **SECURE** |
| `get_facility_handover_location` | DEFINER | `''` | `current_profile_id()` | Farmer restricted until `AUTHORIZED`; denies if `CANCELLED`/`RELEASED` | **SECURE** |
| `verify_technician_kyc` | DEFINER | `''` | `current_profile_id()` | Admin only; rejects full 12-digit UID, PAN, VID; sanitizes remarks | **SECURE** |
| `approve_technician_skill` | DEFINER | `''` | `current_profile_id()` | Admin only; moves skill from suggested to verified | **SECURE** |
| `dismiss_technician_skill` | DEFINER | `''` | `current_profile_id()` | Admin only; removes skill from suggested | **SECURE** |
| `record_load_test_signoff` | DEFINER | `''` | `current_profile_id()` | Assigned tech, facility tech, or admin; locks post-completion | **SECURE** |
| `record_offline_payment_clearance`| DEFINER | `''` | `current_profile_id()` | Assigned tech, facility manager, or admin; approved quote check | **SECURE** |
| `authorize_equipment_handover` | DEFINER | `''` | `current_profile_id()` | Tech/Manager/Admin; requires load test + payment + quote + no depot hold| **SECURE** |
| `execute_equipment_handover_release`| DEFINER| `''` | `current_profile_id()` | Assigned tech or facility member; requires `AUTHORIZED` status | **SECURE** |
| `confirm_farmer_equipment_collection`|DEFINER| `''` | `current_profile_id()` | Only owning farmer; requires `RELEASED` status; idempotent | **SECURE** |
| `reset_demo_data` | DEFINER | `''` | `auth.uid()` | 6 designated demo pairs + demo-code check | **DEFECTIVE (Regression)** |

---

## 4. Detailed Audit Findings

### Finding 1: Missing Direct Mutation Protection on `public.technician_profiles` (CRITICAL)

- **File Reference**: [20261106160000_phase13_database_foundations.sql#L41-L64](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L41-L64), [20261106160000_phase13_database_foundations.sql#L1650-L1810](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L1650-L1810)
- **What is wrong**:
  The migration adds `verified_skills`, `kyc_verified`, `kyc_verified_at`, `kyc_verified_by`, `kyc_document_type`, `kyc_masked_id`, `kyc_remarks`, `rating`, and `review_count` to `public.technician_profiles`.
  However, unlike `repair_requests` (which had column-level UPDATE granted on 16 safe columns and payment columns revoked), `public.technician_profiles` was left with broad table-level `UPDATE` granted to `authenticated`.
  The existing RLS policy `Technicians can update own profile` allows `profile_id = public.current_profile_id()`.
  Consequently, any logged-in technician can directly bypass `verify_technician_kyc()` and `approve_technician_skill()` by issuing:
  ```sql
  UPDATE public.technician_profiles
  SET verified_skills = '["Master Combine Specialist", "Hydraulics Tier 3"]'::jsonb,
      kyc_verified = TRUE,
      rating = 5.00,
      review_count = 100
  WHERE profile_id = auth.uid();
  ```
- **Why it matters**:
  Directly violates **TEST-13-06** (*"Technicians cannot self-promote AI suggestions to verified skills"*) and destroys KYC and review integrity.
- **Concrete Correction**:
  Add an anti-tamper trigger on `public.technician_profiles` preventing non-admin callers from modifying sensitive fields:
  ```sql
  CREATE OR REPLACE FUNCTION public.guard_technician_profile_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_caller_role_text TEXT := public.current_user_role()::text;
  BEGIN
    IF v_caller_role_text NOT IN ('admin', 'service_centre') THEN
      IF (NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified OR
          NEW.kyc_verified_at IS DISTINCT FROM OLD.kyc_verified_at OR
          NEW.kyc_verified_by IS DISTINCT FROM OLD.kyc_verified_by OR
          NEW.kyc_document_type IS DISTINCT FROM OLD.kyc_document_type OR
          NEW.kyc_masked_id IS DISTINCT FROM OLD.kyc_masked_id OR
          NEW.kyc_remarks IS DISTINCT FROM OLD.kyc_remarks OR
          NEW.verified_skills IS DISTINCT FROM OLD.verified_skills OR
          NEW.rating IS DISTINCT FROM OLD.rating OR
          NEW.review_count IS DISTINCT FROM OLD.review_count) THEN
        RAISE EXCEPTION 'FORBIDDEN_MUTATION: Technicians cannot directly alter verified skills, KYC status, or rating metrics.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_guard_technician_profile_mutation ON public.technician_profiles;
  CREATE TRIGGER trg_guard_technician_profile_mutation
  BEFORE UPDATE ON public.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_technician_profile_mutation();
  ```

---

### Finding 2: `public.reset_demo_data()` Regression — Omission of Parts Desk Inventory Restoration (CRITICAL)

- **File Reference**: [20261106160000_phase13_database_foundations.sql#L1814-L1988](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L1814-L1988)
- **What is wrong**:
  The Phase 13 `reset_demo_data()` function overrides the Phase 12 staging implementation ([20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql](file:///d:/Projects/TerraByte/supabase/migrations/20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql)), but omits:
  1. Cascade deletion of `service_centre_part_sales`, `service_centre_part_requests`, and `service_centre_stock_audit`.
  2. Baseline inventory restoration of the 5 canonical stock parts in `public.service_centre_parts` (`0433171`, `005556958R1`, `AL120788`, `HY-GARD-15W30`, `26243171`).
  3. Pre-deletion of `repair_dispatch_locations`, `repair_messages`, and `repair_notes`.
  4. Scoping demo repairs by equipment (`OR equipment_id IN (SELECT id FROM public.equipment WHERE farmer_id = v_demo_farmer_id)`).
- **Why it matters**:
  Overwrites the working Phase 12 demo reset RPC. Executing demo reset in staging will leave dirty inventory quantities, orphaned sales records, and unreset stock audits, breaking automated parts desk integration tests.
- **Concrete Correction**:
  Incorporate the Phase 12 parts restoration blocks and cascading cleanup queries into the Phase 13 `reset_demo_data()` body prior to staging migration execution.

---

### Finding 3: Public Exposure of Sensitive Technician KYC and AI Skills (HIGH)

- **File Reference**: [20261106160000_phase13_database_foundations.sql#L54-L64](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L54-L64)
- **What is wrong**:
  In [20260930000001_initial_schema.sql#L325](file:///d:/Projects/TerraByte/supabase/migrations/20260930000001_initial_schema.sql#L325), `public.technician_profiles` has policy `Technician profiles are viewable by all` (`USING (true)` for `authenticated, anon`).
  Because `20261106160000_phase13_database_foundations.sql` added `kyc_masked_id`, `kyc_document_type`, `kyc_remarks`, and `ai_suggested_skills` without column-level SELECT partitioning or RLS segregation, any anonymous user or competitor can query:
  ```typescript
  supabase.from('technician_profiles').select('profile_id, kyc_masked_id, kyc_remarks, ai_suggested_skills')
  ```
- **Why it matters**:
  Violates KYC data privacy standards and Phase 13 ADRs requiring `ai_suggested_skills` to remain private to the technician and service centre.
- **Concrete Correction**:
  Revoke table-level `SELECT` on `public.technician_profiles` from `anon` and `authenticated`, granting `SELECT` only on public operational columns (`id, profile_id, workshop_name, brands, skills, verified_skills, rating, review_count, is_available, is_verified, distance_km, eta_minutes, primary_facility_id, created_at, updated_at`), and expose sensitive KYC and AI skills exclusively through authorized RPCs or authenticated self/admin views.

---

### Finding 4: Inability for Workshop Owners to Query Their Own Private Facility Columns (HIGH)

- **File Reference**: [20261106160000_phase13_database_foundations.sql#L1658-L1663](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L1658-L1663)
- **What is wrong**:
  The migration correctly revokes table-level `SELECT` on `public.repair_facilities` and grants column-level `SELECT` only on 9 safe coarse columns (`id, name, village, tahsil, operating_hours, drop_off_approved, is_active, created_at, updated_at`) to `authenticated`.
  However, PostgreSQL column-level grants apply to the database role (`authenticated`), not individual user rows.
  As a result, a workshop OWNER or MANAGER cannot execute `supabase.from('repair_facilities').select('phone, address, max_equipment_capacity')` even for their own facility; PostgreSQL rejects the query with error `42501 permission denied for column phone`.
  The only existing handover RPC `get_facility_handover_location()` requires a `p_repair_request_id` and does not serve general workshop management screens.
- **Why it matters**:
  Blocks Milestone 2 frontend development: workshop owners will be unable to view or edit their facility's address, phone, or capacity.
- **Concrete Correction**:
  Define a dedicated `SECURITY DEFINER` RPC `public.get_facility_management_profile(p_facility_id UUID)` that verifies the caller is owner, manager, or Service Centre admin and returns the full facility record.

---

### Finding 5: Operational Load Test Gate Precondition during Frontend Rollout (MEDIUM)

- **File Reference**: [20261106160000_phase13_database_foundations.sql#L338-L343](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql#L338-L343), [repair-requests.ts#L2303-L2318](file:///d:/Projects/TerraByte/src/lib/services/repair-requests.ts#L2303-L2318)
- **What is wrong**:
  `trg_guard_repair_completion_load_test` raises `CANNOT_COMPLETE_WITHOUT_LOAD_TEST` whenever `NEW.status = 'COMPLETED'` unless `NEW.load_test_passed = TRUE`.
  Existing completed repairs in the database are unaffected because the trigger fires only when transitioning from `OLD.status != 'COMPLETED'`.
  However, the current frontend service `completeRepair()` does not invoke `record_load_test_signoff()`.
- **Why it matters**:
  If this migration is applied in staging before the Milestone 3/4 frontend workbench is deployed, technicians will be blocked from completing repairs.
- **Concrete Correction**:
  Ensure staged release coordination: deploy the Milestone 3/4 technician workbench concurrently with migration application in staging, or document this requirement in the staging deployment playbook.

---

### Finding 6: Test Suite Classification & Integration Gap (LOW)

- **File Reference**: [phase-13-db-invariants.test.mjs](file:///d:/Projects/TerraByte/tests/phase-13-db-invariants.test.mjs)
- **What is wrong**:
  All 28 tests in `phase-13-db-invariants.test.mjs` consist of static AST/regex parsing (8 tests) and simulated Node.js algorithms (20 tests). Zero tests execute against a live PostgreSQL server.
- **Why it matters**:
  Simulated tests verify logical contracts but cannot detect runtime PL/pgSQL compilation bugs, real RLS execution behavior, or table-level catalog grant interactions.
- **Concrete Correction**:
  Document test classification accurately in implementation records and establish live integration tests using a local or staging PostgreSQL container before final production sign-off.

---

## 5. Test Quality Assessment

| Test Title in `tests/phase-13-db-invariants.test.mjs` | Classification | Execution Environment |
| :--- | :--- | :--- |
| `Migration 20261106160000_phase13_database_foundations.sql exists and is non-empty` | **Static source inspection** | Local filesystem (Node.js) |
| `Migration alters technician_profiles with nullable rating and Phase 13 fields` | **Static source inspection** | Regex AST matching |
| `Migration alters repair_requests with facility, load-test, payment, and handover fields`| **Static source inspection** | Regex AST matching |
| `Migration hardens service_history with ON DELETE RESTRICT foreign keys` | **Static source inspection** | Regex AST matching |
| `Migration creates repair_facilities, facility_memberships, and technician_reviews tables`| **Static source inspection** | Regex AST matching |
| `Migration defines all 8 required invariant triggers` | **Static source inspection** | Regex AST matching |
| `Migration defines hardened business RPCs with search_path = '' and explicit grants` | **Static source inspection** | Regex AST matching |
| `Migration enforces strict Discretionary Access Control (DAC) & Row Level Security (RLS)`| **Static source inspection** | Regex AST matching |
| `TEST-13-01: Facility RLS & Identity` | **Simulated behavior** | Pure JS RLS evaluation |
| `TEST-13-02: Drop-off Tamper Guard` | **Simulated behavior** | Pure JS trigger simulation |
| `TEST-13-03: In-Person KYC Authorization` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-04: Aadhaar 12-Digit Rejection` | **Simulated behavior** | Pure JS regex simulation |
| `TEST-13-05: Empty Masked ID Rejection & Remarks Sanitization` | **Simulated behavior** | Pure JS validation simulation |
| `TEST-13-06: AI Skill Privilege Boundary` | **Simulated behavior** | Pure JS RPC simulation (Missed direct DB bypass) |
| `TEST-13-07: Review Eligibility Gate` | **Simulated behavior** | Pure JS FK/RLS simulation |
| `TEST-13-08: Review Cross-Tenant Spoofing` | **Simulated behavior** | Pure JS RLS simulation |
| `TEST-13-09: Null Default & Trigger Arithmetic` | **Simulated behavior** | Pure JS aggregation math |
| `TEST-13-10: Single Owner Invariant` | **Simulated behavior** | Pure JS mock table index |
| `TEST-13-11: Unauthorized Owner Transfer` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-12: Load Test Authorization` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-13: Failed Load Test Gate` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-14: Payment Clearance Rejection` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-15: Farmer Collection Ownership` | **Simulated behavior** | Pure JS RPC simulation |
| `TEST-13-16: Concurrent Rating Serialization` | **Simulated behavior** | Pure JS async mutex simulation |
| `Handover Location RPC: Geolocation hidden from farmers until AUTHORIZED` | **Simulated behavior** | Pure JS RPC simulation |
| `Facility Invitation Flow: Pending state, expiration, and authorization` | **Simulated behavior** | Pure JS state machine |
| `Service History Immutability Guard: Trigger unconditionally rejects updates` | **Simulated behavior** | Pure JS exception check |
| `Completed Repair Relational Anti-Tamper Guard: Relational identities frozen` | **Simulated behavior** | Pure JS transition check |

### Minimum Live PostgreSQL Integration Tests Needed Prior to Staging
1. **Direct Column Bypass Test**: Connect as `authenticated` with a technician persona and issue `UPDATE public.technician_profiles SET verified_skills = '["Hacked"]' WHERE profile_id = :my_id`. Must fail with `42501` or trigger exception.
2. **Direct Payment Clearance Bypass Test**: Connect as `authenticated` and issue `UPDATE public.repair_requests SET payment_cleared_at = now()`. Must fail with `42501 permission denied`.
3. **Single Owner Unique Index Test**: Concurrently execute two `INSERT INTO public.facility_memberships` with `role = 'OWNER'` for the same `facility_id`. Must fail with `23505 unique_violation`.
4. **Service History Immutability Test**: Execute `UPDATE public.service_history SET service_type = 'MODIFIED'` as `authenticated` and `service_role`. Must fail with `42501 IMMUTABLE_RECORD`.
5. **Rating Aggregation Trigger Test**: Insert, update, and delete rows in `public.technician_reviews` and assert `public.technician_profiles.rating` transitions from `NULL` to arithmetic average and back to `NULL`.
6. **Full Migration Compilation Test**: Execute `\i supabase/migrations/20261106160000_phase13_database_foundations.sql` on a clean PostgreSQL instance with previous migrations applied. Must complete with `0` warnings or syntax errors.

---

## 6. Actionable Remediation Checklist

Prior to applying this migration to staging or promoting to Milestone 2, execute the following remediation:

- [ ] **Fix Finding 1 (CRITICAL)**: Add `trg_guard_technician_profile_mutation` to `20261106160000_phase13_database_foundations.sql` to block non-admin updates to `rating`, `review_count`, `kyc_*`, and `verified_skills`.
- [ ] **Fix Finding 2 (CRITICAL)**: Restore Phase 12 parts desk inventory cleanup and restoration in `public.reset_demo_data()`.
- [ ] **Fix Finding 3 (HIGH)**: Restrict `SELECT` on `kyc_masked_id`, `kyc_remarks`, and `ai_suggested_skills` to self and administrators.
- [ ] **Fix Finding 4 (HIGH)**: Add `public.get_facility_management_profile(p_facility_id UUID)` RPC to enable workshop owners to retrieve their complete facility details.
- [ ] **Fix Finding 5 (MEDIUM)**: Document deployment sequence ensuring Milestone 3/4 frontend workbench deployment coincides with migration application in staging.
- [ ] **Fix Finding 6 (LOW)**: Update test documentation in `PHASE13_MILESTONE1_IMPLEMENTATION_REPORT.md` to reflect static/simulated nature of test suite.
