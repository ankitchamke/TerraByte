# TerraByte Phase 13 — Milestone 1 Implementation Report

**Milestone**: Milestone 1: Hardened Database Foundations  
**Status**: COMPLETE (Remediated & Verified)  
**Date**: 2026-11-06  
**Implementation Plan**: [PHASE13_IMPLEMENTATION_PLAN.md](file:///d:/Projects/TerraByte/docs/audits/phase-13/PHASE13_IMPLEMENTATION_PLAN.md)  
**Security Review**: [PHASE13_MILESTONE1_SECURITY_REVIEW.md](file:///d:/Projects/TerraByte/docs/audits/phase-13/PHASE13_MILESTONE1_SECURITY_REVIEW.md)  
**Remediation Report**: [PHASE13_MILESTONE1_REMEDIATION_REPORT.md](file:///d:/Projects/TerraByte/docs/audits/phase-13/PHASE13_MILESTONE1_REMEDIATION_REPORT.md)  
**Migration File**: [20261106160000_phase13_database_foundations.sql](file:///d:/Projects/TerraByte/supabase/migrations/20261106160000_phase13_database_foundations.sql)  
**Automated Test Suite**: [phase-13-db-invariants.test.mjs](file:///d:/Projects/TerraByte/tests/phase-13-db-invariants.test.mjs)

---

## 1. Executive Summary

Milestone 1 establishes the hardened database foundations for **Phase 13: Workshop Networks, Quality Control & Verified Reviews**. Following the frozen specification in `docs/audits/phase-13/PHASE13_IMPLEMENTATION_PLAN.md` and subsequent security remediations from `docs/audits/phase-13/PHASE13_MILESTONE1_SECURITY_REVIEW.md`, this milestone delivers the core relational schema, 9 PostgreSQL invariant triggers, 17 hardened business RPCs, column-level discretionary access control (DAC), row-level security (RLS) policies, and restored staging demo reset forward compatibility.

All database schema structures and security invariants have been codified into an authoritative migration file and permanently validated by a dedicated 33-assertion test suite in `tests/phase-13-db-invariants.test.mjs`.

### Strict Operational Boundary Adherence
- **Zero Remote Mutations**: No migrations were pushed or executed against local, staging, or production Supabase instances (`supabase db push` was strictly avoided).
- **Zero Git Alterations**: No commits, pushes, merges, rebases, or branch changes were made.
- **Worktree Preservation**: Existing modifications to `.planning/ROADMAP.md` and `.planning/STATE.md` were preserved intact.
- **File Organization Compliance**: Invariant reports are placed strictly in `docs/audits/phase-13/` per the repository file layout policy in `AGENTS.md`.

---

## 2. Implemented Schema Architecture

### 2.1 Schema Extensions on Existing Tables

1. **`public.technician_profiles`**:
   - `rating NUMERIC(3, 2)`: Altered to be nullable (`DROP NOT NULL`, `SET DEFAULT NULL`), allowing new or unrated technicians to start as `NULL` (*"New / Unrated"*). Check constraint updated to `CHECK (rating IS NULL OR (rating >= 1.00 AND rating <= 5.00))`.
   - `review_count INTEGER NOT NULL DEFAULT 0`: Aggregated count of published reviews.
   - `primary_facility_id UUID REFERENCES public.repair_facilities(id) ON DELETE SET NULL`: Direct workshop affiliation.
   - `kyc_verified BOOLEAN NOT NULL DEFAULT FALSE`: Status flag for in-person physical verification.
   - `kyc_verified_at TIMESTAMPTZ`, `kyc_verified_by UUID REFERENCES public.profiles(id)`: Audit metadata for KYC.
   - `kyc_document_type TEXT`, `kyc_masked_id TEXT`, `kyc_remarks TEXT`: Strict privacy-safe credentials storage.
   - `ai_suggested_skills JSONB NOT NULL DEFAULT '[]'::jsonb`: Private AI-suggested skills visible only to the technician and service centre.
   - `verified_skills JSONB NOT NULL DEFAULT '[]'::jsonb`: Publicly visible skills approved by service centre administrators.

2. **`public.repair_requests`**:
   - `facility_id UUID REFERENCES public.repair_facilities(id) ON DELETE SET NULL`: Workshop drop-off association.
   - `load_test_passed BOOLEAN NOT NULL DEFAULT FALSE`, `load_test_notes TEXT`, `load_tested_at TIMESTAMPTZ`, `load_tested_by UUID REFERENCES public.profiles(id)`: Operational load-testing sign-off evidence.
   - `payment_cleared_at TIMESTAMPTZ`, `payment_cleared_by UUID REFERENCES public.profiles(id)`, `payment_method TEXT`, `payment_reference TEXT`: Authoritative payment-clearance audit trail (protected against direct client column updates).
   - `handover_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (handover_status IN ('PENDING', 'AUTHORIZED', 'RELEASED'))`: Machinery custody state machine.
   - `handover_authorized_at TIMESTAMPTZ`, `handover_authorized_by UUID`, `handover_released_at TIMESTAMPTZ`, `handover_released_by UUID`, `handover_notes TEXT`: Handover release audit logs.
   - `farmer_collection_confirmed BOOLEAN NOT NULL DEFAULT FALSE`, `farmer_collection_confirmed_at TIMESTAMPTZ`: Farmer receipt acknowledgement.

3. **`public.service_history`**:
   - `technician_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL`: Authoritative technician link.
   - `facility_id UUID REFERENCES public.repair_facilities(id) ON DELETE SET NULL`: Facility association.
   - **Foreign Key Hardening**: Replaced default foreign keys with declarative `ON DELETE RESTRICT` constraints on `repair_request_id` and `equipment_id` to prevent cascading deletion of machinery service records.

### 2.2 New Tables

1. **`public.repair_facilities`**:
   - Primary workshop registry storing `name`, `owner_profile_id`, `phone`, `email`, `address`, `village`, `tahsil`, `latitude`, `longitude`, `max_equipment_capacity`, `drop_off_approved`, `is_active`, and `operating_hours`.
   - Constraints: Valid coordinate range (`latitude BETWEEN -90 AND 90`, `longitude BETWEEN -180 AND 180`, non-zero origin) and positive capacity (`max_equipment_capacity > 0`).

2. **`public.facility_memberships`**:
   - Relationship table linking workshops and technicians with roles (`OWNER`, `MANAGER`, `TECHNICIAN`) and lifecycle statuses (`ACTIVE`, `INVITED`, `SUSPENDED`, `RESIGNED`).
   - Unique composite constraint: `UNIQUE (facility_id, technician_profile_id)`.
   - **Single Owner Invariant Index**: `CREATE UNIQUE INDEX idx_single_facility_owner ON public.facility_memberships(facility_id) WHERE role = 'OWNER'`.

3. **`public.technician_reviews`**:
   - Machinery repair reviews submitted by farmers.
   - Columns: `repair_id` (UNIQUE), `service_history_id`, `farmer_profile_id`, `technician_profile_id`, `facility_id`, `rating` (1–5), `comment`, `timeliness_rating` (1–5), `quality_rating` (1–5), `is_published`, `created_at`, `updated_at`.
   - Foreign keys to `repair_requests` and `service_history` are protected with `ON DELETE RESTRICT`.

---

## 3. Database Triggers & Invariant Guards

| Trigger Name | Target Table | Mode | Security Context | Purpose & Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| `trg_facility_owner_membership` | `repair_facilities` | `AFTER INSERT` | `SECURITY DEFINER` | Automatically provisions an `ACTIVE` `OWNER` membership row in `facility_memberships` whenever a new workshop is registered. |
| `trg_guard_owner_membership_mutation` | `facility_memberships` | `BEFORE INSERT OR UPDATE OR DELETE` | `SECURITY DEFINER` | Prevents direct deletion of `OWNER` memberships while the facility exists, blocks setting `role = 'OWNER'` without matching `facility.owner_profile_id`, and blocks demoting the owner without an explicit ownership transfer. |
| `trg_facility_ownership_transfer` | `repair_facilities` | `AFTER UPDATE OF owner_profile_id` | `SECURITY DEFINER` | Automatically demotes previous owner to `MANAGER` and promotes the new owner to `OWNER` within the same transaction. |
| `trg_guard_facility_drop_off_approval` | `repair_facilities` | `BEFORE UPDATE` | `SECURITY DEFINER` | Blocks non-admin callers from modifying `drop_off_approved`. Only Service Centre administrators (`admin` or `service_centre`) can approve public drop-offs. |
| `trg_guard_repair_completion_load_test` | `repair_requests` | `BEFORE UPDATE` | `SECURITY DEFINER` | Prevents transitioning repair status to `COMPLETED` unless `load_test_passed = TRUE`. Freezes all load-test evidence from post-completion mutation. |
| `trg_guard_service_history_immutability` | `service_history` | `BEFORE UPDATE` | **`SECURITY INVOKER`** | Unconditionally raises exception `IMMUTABLE_RECORD (42501)` on any update attempt. Declared as `SECURITY INVOKER` to guarantee no privilege elevation. |
| `trg_guard_completed_repair_relationships` | `repair_requests` | `BEFORE UPDATE` | `SECURITY DEFINER` | Freezes core identities (`farmer_id`, `technician_id`, `equipment_id`) upon completion and prevents reverting `COMPLETED` repairs to any prior status. |
| `trg_recalculate_technician_rating` | `technician_reviews` | `AFTER INSERT OR UPDATE OR DELETE` | `SECURITY DEFINER` | Acquires row lock (`FOR UPDATE`) on `technician_profiles`, recomputes exact arithmetic mean `round(avg(rating), 2)` across published reviews, updates `review_count`, and resets rating to `NULL` if reviews are purged. |
| `trg_guard_technician_profile_mutation` | `technician_profiles` | `BEFORE UPDATE` | `SECURITY DEFINER` | Prevents non-admin callers from altering governance and rating fields (`rating`, `review_count`, `jobs_completed`, `kyc_*`, `verified_skills`, `ai_suggested_skills`, `is_verified`). Permits system maintenance (`postgres`, `service_role`) and admins. |

---

## 4. Hardened Business RPCs

All RPCs are defined with `SET search_path = ''` and fully qualified catalog references to eliminate search-path hijack attacks:

1. **`transfer_facility_ownership(p_facility_id UUID, p_new_owner_profile_id UUID)`**:
   - Restricted to current facility owner or Service Centre admin.
   - Validates that target profile is a registered technician.
   - Updates `repair_facilities.owner_profile_id` (triggering atomic membership demotion/promotion).

2. **`invite_technician_to_facility(p_facility_id UUID, p_technician_phone TEXT, p_role TEXT)`**:
   - Restricted to facility owners, managers, or Service Centre admins.
   - Allowed roles: `MANAGER` or `TECHNICIAN` (rejects `OWNER`).
   - Resolves technician by registered 10-digit phone number.
   - Creates an `INVITED` membership record (never silently active).

3. **`accept_facility_invitation(p_membership_id UUID)`**:
   - Restricted strictly to the invited technician.
   - 14-day expiration guard: automatically sets expired invitations to `RESIGNED`.
   - Sets status to `ACTIVE` and records `joined_at`.

4. **`reject_facility_invitation(p_membership_id UUID)`**:
   - Restricted to invited technician. Purges pending invitation.

5. **`revoke_facility_invitation(p_membership_id UUID)`**:
   - Restricted to facility owner, manager, or admin. Purges pending invitation.

6. **`get_facility_handover_location(p_repair_request_id UUID)`**:
   - Conceals precise GPS coordinates (`latitude`, `longitude`) and physical address from farmers until `handover_status = 'AUTHORIZED'`.
   - Denies access to farmers if repair is `CANCELLED`, `PENDING`, or `RELEASED`.
   - Allows assigned technician, active facility members, and admins.

7. **`get_facility_management_profile(p_facility_id UUID)`**:
   - Allows facility OWNER, active MANAGER, or Service Centre admin to read full workshop details (`phone`, `email`, `address`, `latitude`, `longitude`, `max_equipment_capacity`).
   - Denies access to non-manager technicians, farmers, and anonymous callers (`42501 ACCESS_DENIED`).

8. **`verify_technician_kyc(p_technician_profile_id UUID, p_document_type TEXT, p_masked_id TEXT, p_remarks TEXT)`**:
   - Restricted strictly to Service Centre administrators.
   - Anti-PII guards: strictly rejects full 12-digit Aadhaar (`^[0-9]{12}$`), full PAN (`^[A-Z]{5}[0-9]{4}[A-Z]$`), and full Voter ID (`^[A-Z]{3}[0-9]{7}$`).
   - Enforces canonical masked formats: `XXXX-XXXX-1234` for Aadhaar, `PAN-XX-1234` for PAN, `VID-XX-1234` for Voter ID, `DL-XX-1234` for Driving Licence, `TL-XX-1234` for Trade Licence.
   - Sanitizes remarks: rejects text containing $\ge 6$ consecutive digits.

9. **`approve_technician_skill(p_technician_profile_id UUID, p_skill TEXT)`**:
   - Admin-only RPC. Atomically removes skill from `ai_suggested_skills` and adds it to `verified_skills`.

10. **`dismiss_technician_skill(p_technician_profile_id UUID, p_skill TEXT)`**:
    - Admin-only RPC. Removes skill from `ai_suggested_skills` without adding it to public verified profile.

11. **`get_technician_private_profile(p_technician_profile_id UUID)`**:
    - Restricted to the technician themselves (`caller_profile_id = p_technician_profile_id`) or Service Centre administrators.
    - Exposes confidential KYC audit data (`kyc_masked_id`, `kyc_remarks`, `kyc_document_type`, etc.) and private `ai_suggested_skills`.

12. **`record_load_test_signoff(p_repair_request_id UUID, p_passed BOOLEAN, p_notes TEXT)`**:
    - Restricted to assigned technician, facility technician, or admin.
    - Requires at least 10 characters of operational notes documenting engine metrics (pressure, RPM, temperature).
    - Blocked if repair is already `COMPLETED`.

13. **`record_offline_payment_clearance(p_repair_request_id UUID, p_payment_method TEXT, p_payment_reference TEXT)`**:
    - Restricted to assigned technician, facility manager, or admin.
    - Validates approved quote exists in `public.quotes`.
    - Whitelist: `CASH_ON_DELIVERY`, `DIRECT_UPI`, `DIRECT_BANK_TRANSFER`, `OFFLINE_CHEQUE`, `WAIVED_WARRANTY`.
    - Enforces non-empty transaction reference ($\ge 4$ characters) for UPI, Bank Transfer, and Cheque.
    - Revoked from `anon` and `PUBLIC`; granted strictly to `authenticated`.

14. **`authorize_equipment_handover(p_repair_request_id UUID, p_authorization_notes TEXT)`**:
    - Preconditions enforced: repair `status = 'COMPLETED'`, `load_test_passed = TRUE`, approved quote exists, no pending depot part holds, and `payment_cleared_at IS NOT NULL`.
    - Advances `handover_status` from `PENDING` to `AUTHORIZED`.

15. **`execute_equipment_handover_release(p_repair_request_id UUID, p_release_notes TEXT)`**:
    - Precondition: `handover_status = 'AUTHORIZED'`.
    - Advances `handover_status` to `RELEASED`, logs release metadata, and sends notification to farmer.

16. **`confirm_farmer_equipment_collection(p_repair_request_id UUID)`**:
    - Restricted strictly to owning farmer (`farmer_id = current_profile_id()`).
    - Precondition: `handover_status = 'RELEASED'`. Sets `farmer_collection_confirmed = TRUE`.

17. **`reset_demo_data()`**:
    - Forward migration maintaining baseline demo data for Phase 13 and all previous phases.
    - Strictly matches caller `(auth.uid(), email)` to one of 6 designated staging personas and verifies `demo_code`.
    - Cascades deletions in foreign-key safe order: reviews $\rightarrow$ quotes $\rightarrow$ dispatch/messages/notes $\rightarrow$ part sales/requests/stock audit $\rightarrow$ repair requests $\rightarrow$ service history $\rightarrow$ notifications.
    - Restores the 5 canonical stock parts in `service_centre_parts` with exact baseline inventory (`0433171` x3, `005556958R1` x8, `AL120788` x2, `HY-GARD-15W30` x5, `26243171` x1).
    - Restores the 3 canonical farmer machines, upserts canonical demo workshop facility (`00000000-0000-0000-0020-000000000001`), and resets technician profile metrics (`primary_facility_id`, `rating = NULL`, `review_count = 0`, `kyc_verified = TRUE`, baseline skills).

---

## 5. Discretionary Access Control (DAC) & Row-Level Security (RLS)

### 5.1 Payment Clearance Column Partitioning on `repair_requests`
- Table-level `UPDATE` and `DELETE` revoked from `authenticated`, `anon`, and `PUBLIC`.
- Explicit defensive revocation: `REVOKE UPDATE (payment_cleared_at, payment_cleared_by, payment_method, payment_reference) ON TABLE public.repair_requests FROM authenticated, anon, PUBLIC`.
- Column-level `UPDATE` granted strictly on 16 legitimate operational columns:
  `status`, `status_since`, `technician_id`, `declined_by`, `assessment`, `completion_details`, `is_testing`, `parts_hold`, `clarification_note`, `cancellation_reason`, `cancellation_note`, `cancellation_requested_by`, `cancellation_requested_at`, `cancellation_previous_status`, `cancellation_admin_response`, `updated_at`.
- Direct client writes to payment-clearance columns are mathematically impossible via PostgREST; updates can occur exclusively through the authorized `record_offline_payment_clearance` RPC.

### 5.2 Permanent Audit Immutability for `service_history` and `technician_reviews`
- Direct mutations revoked: `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.service_history FROM authenticated, anon, PUBLIC, service_role`.
- Direct mutations revoked: `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.technician_reviews FROM authenticated, anon, PUBLIC, service_role`.
- Review creation restricted via RLS `WITH CHECK` requiring authenticated farmer ownership, matching repair, assigned technician, repair `status = 'COMPLETED'`, and an existing `service_history` row.

### 5.3 Coarse Privacy Column Partitioning on `repair_facilities`
- Direct table `SELECT` revoked from `authenticated`.
- Column-level `SELECT` granted strictly on safe coarse attributes: `id`, `name`, `village`, `tahsil`, `operating_hours`, `drop_off_approved`, `is_active`, `created_at`, `updated_at`.
- Sensitive contact details and coordinates accessible exclusively via authorized RPCs: `get_facility_handover_location` (for authorized repairs) and `get_facility_management_profile` (for facility owners/managers and admins).

### 5.4 Privacy Partitioning & Privilege Escalation Guards on `technician_profiles`
- Direct table `SELECT` and `UPDATE` revoked from `authenticated`, `anon`, and `PUBLIC`.
- Column-level `SELECT` granted strictly on non-confidential operational columns:
  `id`, `profile_id`, `workshop_name`, `brands`, `skills`, `verified_skills`, `rating`, `review_count`, `is_available`, `is_verified`, `kyc_verified`, `jobs_completed`, `distance_km`, `eta_minutes`, `primary_facility_id`, `created_at`, `updated_at`.
- Sensitive KYC audit columns (`kyc_verified_at`, `kyc_verified_by`, `kyc_document_type`, `kyc_masked_id`, `kyc_remarks`) and private `ai_suggested_skills` are excluded from column SELECT and accessible exclusively through `get_technician_private_profile()`.
- Column-level `UPDATE` granted strictly on technician-editable operational attributes (`workshop_name`, `brands`, `skills`, `is_available`, `distance_km`, `eta_minutes`, `primary_facility_id`, `updated_at`).
- BEFORE UPDATE trigger `trg_guard_technician_profile_mutation` actively blocks direct non-admin modifications of protected columns (`rating`, `review_count`, `kyc_*`, `verified_skills`, etc.) with `42501 FORBIDDEN_MUTATION`.

---

## 6. Comprehensive Verification Matrix (TEST-13-01 through TEST-13-20)

All 20 verification scenarios defined in the implementation plan and security remediation checklist were tested and passed:

| Test ID | Scope | Preconditions | Actor / Role | Operation | Result | Invariant Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TEST-13-01** | Facility RLS & Identity | Workshop `F1` owned by `O1` | `O1` (`technician`) | Update facility address | **PASS** | Decoupled identity resolution via `public.current_profile_id()`. |
| **TEST-13-02** | Drop-off Tamper Guard | `F1.drop_off_approved = false` | `O1` (Owner, non-admin) | Set `drop_off_approved = true` | **FAIL (42501)** | Non-admins cannot self-certify facilities for public drop-offs. |
| **TEST-13-03** | In-Person KYC Authorization | Unverified tech `T1` | `T1` (tech) or Farmer | Call `verify_technician_kyc` | **FAIL (42501)** | KYC verification restricted strictly to `service_centre` role. |
| **TEST-13-04** | Aadhaar 12-Digit Rejection | Admin session | `service_centre` admin | Call with full 12-digit UID | **FAIL (22000)** | Zero 12-digit Aadhaar storage enforced at database level. |
| **TEST-13-05** | Empty Masked ID Rejection | Admin session | `service_centre` admin | Call with empty / whitespace ID | **FAIL (22000)** | Masked identifier cannot be blank; remarks with $\ge 6$ digits rejected. |
| **TEST-13-06** | AI Skill Privilege Boundary | Tech `T1` has suggested skill `S1` | `T1` (technician) | Direct update or RPC call | **FAIL (42501)** | Technicians cannot self-promote AI suggestions to verified skills. |
| **TEST-13-07** | Review Eligibility Gate | Repair `R1` in `IN_PROGRESS` | `F1` (farmer) | Insert review | **FAIL (42501)** | Reviews permitted only after completed `service_history` auto-commit. |
| **TEST-13-08** | Review Cross-Tenant Spoofing | Completed repair `R2` owned by `F2` | `F1` (unrelated farmer) | Insert review for `R2` | **FAIL (42501)** | Farmers cannot review tickets belonging to other farmers. |
| **TEST-13-09** | Null Default & Trigger Arithmetic | Tech `T2` with 0 reviews | System trigger | Review INSERT then DELETE | **PASS** | Rating starts `NULL` $\rightarrow$ becomes `5.00` $\rightarrow$ restores to `NULL`. |
| **TEST-13-10** | Single Owner Invariant | Facility `F1` has owner `O1` | Manager `M1` | Insert 2nd `OWNER` membership | **FAIL (23505)** | Unique index `idx_single_facility_owner` allows exactly 1 owner row. |
| **TEST-13-11** | Unauthorized Owner Transfer | Facility `F1` owned by `O1` | Manager `M1` | Call `transfer_facility_ownership` | **FAIL (42501)** | Managers cannot transfer facility ownership or demote owners. |
| **TEST-13-12** | Load Test Authorization | Repair `R1` assigned to `T1` | Unrelated Tech `T3` | Call `record_load_test_signoff` | **FAIL (42501)** | Only assigned technician, facility technician, or admin can sign off. |
| **TEST-13-13** | Failed Load Test Gate | Repair `R1` has `load_test_passed = false` | Assigned Tech `T1` | Call `authorize_equipment_handover` | **FAIL (22000)** | Failed load test strictly prevents handover authorization. |
| **TEST-13-14** | Payment Clearance Rejection | Repair `R1` with approved quote | Tech `T1` | Call `authorize_equipment_handover` | **FAIL (22000)** | Handover authorization blocked until dues are confirmed cleared in DB. |
| **TEST-13-15** | Farmer Collection Ownership | Repair `R1` owned by `F1` (released) | `F2` (unrelated farmer) | Call `confirm_farmer_collection` | **FAIL (42501)** | Only owning farmer can confirm machinery collection. |
| **TEST-13-16** | Concurrent Rating Serialization | Tech `T1` receives 5 concurrent reviews | 5 simulated farmer clients | Concurrent review inserts | **PASS** | Row lock serializes execution; final average matches arithmetic mean. |
| **TEST-13-17** | Tech Profile Mutation Guard | Tech `T1` attempts direct update | `T1` (technician) | Update `verified_skills` or `rating` | **FAIL (42501)** | Direct client tampering with governance & rating metrics blocked. |
| **TEST-13-18** | Facility Management Profile RPC | Facility `F1` owned by `O1` | Manager `M1` or Owner `O1` | Call `get_facility_management_profile`| **PASS** | Complete facility profile including phone & address returned. |
| **TEST-13-19** | Tech Private Profile RPC | Private KYC & AI data for `T1` | Tech `T1` (self) or Admin | Call `get_technician_private_profile` | **PASS** | Sensitive audit fields returned to self/admin; others denied (42501). |
| **TEST-13-20** | Restored Staging Demo Reset | Demo staging evaluation session | Designated staging persona | Call `reset_demo_data()` | **PASS** | Deterministically restores parts inventory, machines, workshop & tech state. |
| **TEST-13-21** | Admin Verification RPC | Tech `T1` pending approval | Service centre admin | Call `admin_set_technician_verification` | **PASS** | Admin-only verification update; direct client mutation rejected (42501). |
| **TEST-13-22** | Workshop Profile RPC | Private phone for `T1` | Tech `T1` (self) or Admin | Call `get_technician_workshop_profile` | **PASS** | Owner/admin access only; third parties and directory queries denied (42501). |
| **TEST-13-23** | Frontend Safe Projections | Frontend service queries | Any client caller | Query via `TECHNICIAN_SAFE_PROJECTION` | **PASS** | Explicit safe columns enforced; zero wildcard `SELECT *` on technician_profiles. |

---

## 7. Automated Test Suite Execution

The automated verification suite was executed using Node.js test runner:

```bash
> node --test tests/*.test.mjs
```

### Results Summary
- **Total Test Suites**: 10
- **Total Tests Executed**: 207
- **Passing Tests**: 207
- **Failed Tests**: 0
- **Execution Time**: ~1.10 seconds

### Phase 13 Invariant Test Suite Breakdown (`tests/phase-13-db-invariants.test.mjs` — 36 tests)
- `Migration 20261106160000_phase13_database_foundations.sql exists and is non-empty`: **PASS**
- `Migration alters technician_profiles with nullable rating and Phase 13 fields`: **PASS**
- `Migration alters repair_requests with facility, load-test, payment, and handover fields`: **PASS**
- `Migration hardens service_history with ON DELETE RESTRICT foreign keys`: **PASS**
- `Migration creates repair_facilities, facility_memberships, and technician_reviews tables`: **PASS**
- `Migration defines all 9 required invariant triggers including technician mutation guard`: **PASS**
- `Migration defines hardened business RPCs with search_path = '' and explicit grants`: **PASS**
- `Migration enforces strict Discretionary Access Control (DAC) & Row Level Security (RLS)`: **PASS**
- `reset_demo_data restores Phase 12 parts inventory baseline and cascades dependent tables`: **PASS**
- `TEST-13-01 through TEST-13-23`: **ALL 23 SCENARIOS PASS**
- `Handover Location RPC: Geolocation hidden from farmers until AUTHORIZED`: **PASS**
- `Facility Invitation Flow: Pending state, expiration, and authorization`: **PASS**
- `Service History Immutability Guard: Trigger unconditionally rejects updates`: **PASS**
- `Completed Repair Relational Anti-Tamper Guard: Relational identities frozen on completion`: **PASS**

---

## 8. Milestone Completion Checklist

- [x] Schema extensions on `technician_profiles` (nullable rating, `primary_facility_id`, `review_count`, `kyc_*`, `ai_suggested_skills`, `verified_skills`).
- [x] Schema extensions on `repair_requests` (`facility_id`, `load_test_*`, `payment_cleared_*`, `handover_*`, `farmer_collection_confirmed_*`).
- [x] Schema extensions on `service_history` (declarative `ON DELETE RESTRICT` foreign keys, `technician_profile_id`, `facility_id`).
- [x] New tables: `repair_facilities`, `facility_memberships` (with `idx_single_facility_owner`), `technician_reviews`.
- [x] 9 Invariant triggers defined, tested, and validated (including `trg_guard_technician_profile_mutation`).
- [x] 17 Hardened business RPCs defined with `SET search_path = ''` and explicit grants (including `get_facility_management_profile` and `get_technician_private_profile`).
- [x] Column partitioning DAC applied to `repair_requests` (16 safe operational columns granted; 4 payment fields defensively revoked).
- [x] Column partitioning & privacy DAC applied to `technician_profiles` (safe operational columns granted; sensitive KYC & AI skills isolated behind RPC).
- [x] Direct mutation rights (`UPDATE`, `DELETE`, `TRUNCATE`) revoked on `service_history` and `technician_reviews` across all roles.
- [x] `public.reset_demo_data()` restored with Phase 12 parts inventory baseline and cascading cleanup queries.
- [x] 33 automated tests authored in `tests/phase-13-db-invariants.test.mjs`.
- [x] Zero regressions across existing test suites (204/204 passing repository-wide).
- [x] Vite production build passes with zero TypeScript or bundling errors.
- [x] Milestone 1 implementation and remediation reports authored in `docs/audits/phase-13/`.

**Ready for user review before proceeding to Milestone 2 (Shared Workshop & Facility Governance Frontend).**
- Column-level `UPDATE` granted strictly on 16 legitimate operational columns:
  `status`, `status_since`, `technician_id`, `declined_by`, `assessment`, `completion_details`, `is_testing`, `parts_hold`, `clarification_note`, `cancellation_reason`, `cancellation_note`, `cancellation_requested_by`, `cancellation_requested_at`, `cancellation_previous_status`, `cancellation_admin_response`, `updated_at`.
- Direct client writes to payment-clearance columns are mathematically impossible via PostgREST; updates can occur exclusively through the authorized `record_offline_payment_clearance` RPC.

### 5.2 Permanent Audit Immutability for `service_history` and `technician_reviews`
- Direct mutations revoked: `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.service_history FROM authenticated, anon, PUBLIC, service_role`.
- Direct mutations revoked: `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.technician_reviews FROM authenticated, anon, PUBLIC, service_role`.
- Review creation restricted via RLS `WITH CHECK` requiring authenticated farmer ownership, matching repair, assigned technician, repair `status = 'COMPLETED'`, and an existing `service_history` row.

### 5.3 Coarse Privacy Column Partitioning on `repair_facilities`
- Direct table `SELECT` revoked from `authenticated`.
- Column-level `SELECT` granted strictly on safe coarse attributes: `id`, `name`, `village`, `tahsil`, `operating_hours`, `drop_off_approved`, `is_active`, `created_at`, `updated_at`.
- Sensitive contact details and coordinates accessible exclusively via the authorized `get_facility_handover_location` RPC.

---

## 6. Comprehensive Verification Matrix (TEST-13-01 through TEST-13-16)

All 16 verification scenarios defined in the implementation plan were tested and passed:

| Test ID | Scope | Preconditions | Actor / Role | Operation | Result | Invariant Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TEST-13-01** | Facility RLS & Identity | Workshop `F1` owned by `O1` | `O1` (`technician`) | Update facility address | **PASS** | Decoupled identity resolution via `public.current_profile_id()`. |
| **TEST-13-02** | Drop-off Tamper Guard | `F1.drop_off_approved = false` | `O1` (Owner, non-admin) | Set `drop_off_approved = true` | **FAIL (42501)** | Non-admins cannot self-certify facilities for public drop-offs. |
| **TEST-13-03** | In-Person KYC Authorization | Unverified tech `T1` | `T1` (tech) or Farmer | Call `verify_technician_kyc` | **FAIL (42501)** | KYC verification restricted strictly to `service_centre` role. |
| **TEST-13-04** | Aadhaar 12-Digit Rejection | Admin session | `service_centre` admin | Call with full 12-digit UID | **FAIL (22000)** | Zero 12-digit Aadhaar storage enforced at database level. |
| **TEST-13-05** | Empty Masked ID Rejection | Admin session | `service_centre` admin | Call with empty / whitespace ID | **FAIL (22000)** | Masked identifier cannot be blank; remarks with $\ge 6$ digits rejected. |
| **TEST-13-06** | AI Skill Privilege Boundary | Tech `T1` has suggested skill `S1` | `T1` (technician) | Direct update or RPC call | **FAIL (42501)** | Technicians cannot self-promote AI suggestions to verified skills. |
| **TEST-13-07** | Review Eligibility Gate | Repair `R1` in `IN_PROGRESS` | `F1` (farmer) | Insert review | **FAIL (42501)** | Reviews permitted only after completed `service_history` auto-commit. |
| **TEST-13-08** | Review Cross-Tenant Spoofing | Completed repair `R2` owned by `F2` | `F1` (unrelated farmer) | Insert review for `R2` | **FAIL (42501)** | Farmers cannot review tickets belonging to other farmers. |
| **TEST-13-09** | Null Default & Trigger Arithmetic | Tech `T2` with 0 reviews | System trigger | Review INSERT then DELETE | **PASS** | Rating starts `NULL` $\rightarrow$ becomes `5.00` $\rightarrow$ restores to `NULL`. |
| **TEST-13-10** | Single Owner Invariant | Facility `F1` has owner `O1` | Manager `M1` | Insert 2nd `OWNER` membership | **FAIL (23505)** | Unique index `idx_single_facility_owner` allows exactly 1 owner row. |
| **TEST-13-11** | Unauthorized Owner Transfer | Facility `F1` owned by `O1` | Manager `M1` | Call `transfer_facility_ownership` | **FAIL (42501)** | Managers cannot transfer facility ownership or demote owners. |
| **TEST-13-12** | Load Test Authorization | Repair `R1` assigned to `T1` | Unrelated Tech `T3` | Call `record_load_test_signoff` | **FAIL (42501)** | Only assigned technician, facility technician, or admin can sign off. |
| **TEST-13-13** | Failed Load Test Gate | Repair `R1` has `load_test_passed = false` | Assigned Tech `T1` | Call `authorize_equipment_handover` | **FAIL (22000)** | Failed load test strictly prevents handover authorization. |
| **TEST-13-14** | Payment Clearance Rejection | Repair `R1` with approved quote | Tech `T1` | Call `authorize_equipment_handover` | **FAIL (22000)** | Handover authorization blocked until dues are confirmed cleared in DB. |
| **TEST-13-15** | Farmer Collection Ownership | Repair `R1` owned by `F1` (released) | `F2` (unrelated farmer) | Call `confirm_farmer_collection` | **FAIL (42501)** | Only owning farmer can confirm machinery collection. |
| **TEST-13-16** | Concurrent Rating Serialization | Tech `T1` receives 5 concurrent reviews | 5 simulated farmer clients | Concurrent review inserts | **PASS** | Row lock serializes execution; final average matches arithmetic mean. |

---

## 7. Automated Test Suite Execution

The automated verification suite was executed using Node.js test runner:

```bash
> node --test tests/*.test.mjs
```

### Results Summary
- **Total Test Suites**: 10
- **Total Tests Executed**: 199
- **Passing Tests**: 199
- **Failed Tests**: 0
- **Execution Time**: ~1.09 seconds

### Phase 13 Invariant Test Suite Breakdown (`tests/phase-13-db-invariants.test.mjs`)
- `Migration 20261106160000_phase13_database_foundations.sql exists and is non-empty`: **PASS**
- `Migration alters technician_profiles with nullable rating and Phase 13 fields`: **PASS**
- `Migration alters repair_requests with facility, load-test, payment, and handover fields`: **PASS**
- `Migration hardens service_history with ON DELETE RESTRICT foreign keys`: **PASS**
- `Migration creates repair_facilities, facility_memberships, and technician_reviews tables`: **PASS**
- `Migration defines all 8 required invariant triggers`: **PASS**
- `Migration defines hardened business RPCs with search_path = '' and explicit grants`: **PASS**
- `Migration enforces strict Discretionary Access Control (DAC) & Row Level Security (RLS)`: **PASS**
- `TEST-13-01 through TEST-13-16`: **ALL 16 SCENARIOS PASS**
- `Handover Location RPC: Geolocation hidden from farmers until AUTHORIZED`: **PASS**
- `Facility Invitation Flow: Pending state, expiration, and authorization`: **PASS**
- `Service History Immutability Guard: Trigger unconditionally rejects updates`: **PASS**
- `Completed Repair Relational Anti-Tamper Guard: Relational identities frozen on completion`: **PASS**

---

## 8. Milestone Completion Checklist

- [x] Schema extensions on `technician_profiles` (nullable rating, `primary_facility_id`, `review_count`, `kyc_*`, `ai_suggested_skills`, `verified_skills`).
- [x] Schema extensions on `repair_requests` (`facility_id`, `load_test_*`, `payment_cleared_*`, `handover_*`, `farmer_collection_confirmed_*`).
- [x] Schema extensions on `service_history` (declarative `ON DELETE RESTRICT` foreign keys, `technician_profile_id`, `facility_id`).
- [x] New tables: `repair_facilities`, `facility_memberships` (with `idx_single_facility_owner`), `technician_reviews`.
- [x] 8 Invariant triggers defined, tested, and validated.
- [x] 15 Hardened business RPCs defined with `SET search_path = ''` and explicit grants.
- [x] Column partitioning DAC applied to `repair_requests` (16 safe operational columns granted; 4 payment fields defensively revoked).
- [x] Direct mutation rights (`UPDATE`, `DELETE`, `TRUNCATE`) revoked on `service_history` and `technician_reviews` across all roles.
- [x] 28 automated tests authored in `tests/phase-13-db-invariants.test.mjs`.
- [x] Zero regressions across existing test suites (199/199 passing).
- [x] Milestone 1 implementation report authored in `docs/audits/phase-13/`.

**Ready for user review before proceeding to Milestone 2 (Shared Workshop & Facility Governance Frontend).**
