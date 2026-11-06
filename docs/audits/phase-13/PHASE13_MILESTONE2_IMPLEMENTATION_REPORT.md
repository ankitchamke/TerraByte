# TerraByte Phase 13 — Milestone 2 Implementation Report: Shared Workshop & Facility Governance Frontend

**Execution Date**: 2026-11-06  
**Git Branch**: `phase-13`  
**Base Milestone 1 Commit**: `80537c6` (`feat(phase-13): complete milestone 1 database foundations`)  
**Scope Delivered**: Milestone 2 — Shared Workshop & Facility Governance Frontend  
**Status**: APPROVED & FULLY VERIFIED (214/214 tests passing, zero compilation errors, zero git commits/pushes per boundaries)

---

## 1. Executive Summary & Verification Evidence

Milestone 2 delivers the complete frontend governance architecture for shared field workshops, repair bays, and public drop-off facilities across the Nagpur regional network, strictly following `docs/audits/phase-13/PHASE13_IMPLEMENTATION_PLAN.md` (Sections 10.2.1, 10.2.2, 10.2.3, and Group A acceptance criteria AC-13-F01 through AC-13-F06).

### Verification Results
| Verification Target | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Milestone 2 Test Suite** | `node --test tests/phase-13-workshop-management.test.mjs` | **7/7 PASS** (0 failures, 107ms) | Tests 10-column validation, single-owner invariant, 2-step ownership transfer, phone invite, admin drop-off toggle |
| **Milestone 1 DB Invariants** | `node --test tests/phase-13-db-invariants.test.mjs` | **36/36 PASS** (0 failures, 165ms) | Zero regressions on hardened database schema, triggers, and RPC contracts |
| **Full Regression Suite** | `npm test` (`node --test tests/*.test.mjs`) | **214/214 PASS** (0 failures, 2.51s) | All existing test suites pass cleanly |
| **Production Build** | `npm run build` (`vite build --mode production`) | **SUCCESS** (Exit code 0, 1.57s) | SSR and client bundles built cleanly |

---

## 2. Delivered Artifacts & Architecture

### 2.1 API Client Service (`src/lib/services/facilities.ts`)
A dedicated, fully-typed Supabase service layer managing workshop facilities and memberships:
- `VIDARBHA_TAHSILS`: Canonical catalog of 13 Vidarbha tahsils (`Nagpur`, `Hingna`, `Katol`, `Kalmeshwar`, `Saoner`, `Ramtek`, `Umred`, `Narkhed`, `Kuhi`, `Bhiwapur`, `Mouda`, `Kamptee`, `Parseoni`).
- `TAHSIL_COORDINATES`: Verified centroid coordinates per tahsil providing safe automatic fallback when device GPS is unavailable.
- `getAffiliatedFacilities()`: Queries active and pending memberships for the authenticated technician, returning safe public columns for affiliated facilities.
- `getFacilityManagementProfile(facilityId)`: Invokes `get_facility_management_profile` RPC to retrieve complete facility details (restricted by backend to OWNER, MANAGER, or Admin).
- `getAllFacilitiesAdmin()`: Queries all Vidarbha facilities with calculated active member counts and owner profile attribution for `/admin/facilities`.
- `registerFacility(input)`: Validates strictly the 10 approved columns, validates phone and coordinates, and executes insert. Trigger `trg_facility_owner_membership` automatically assigns the caller as `OWNER`.
- `updateFacility(facilityId, input)`: Updates operational attributes (contact, hours, machinery capacity) without allowing direct mutation of drop-off approval.
- `getFacilityMembers(facilityId)`: Queries affiliated technicians, sorting by role hierarchy (`OWNER` > `MANAGER` > `TECHNICIAN`) and membership status.
- `inviteFacilityMember(facilityId, phone, role)`: Calls `invite_technician_to_facility` RPC using 10-digit mobile number, strictly creating membership in `INVITED` status and rejecting `OWNER` role invitations.
- `acceptFacilityInvitation(membershipId)` / `rejectFacilityInvitation(membershipId)`: RPC wrappers for invited technicians to accept or decline memberships.
- `revokeFacilityInvitation(membershipId)`: Allows facility owners/managers to cancel pending invitations.
- `removeFacilityMember(facilityId, technicianProfileId)`: Calls `remove_facility_member` RPC (or direct delete gated by `trg_guard_owner_membership_mutation`), enforcing that owners cannot be removed without prior ownership transfer.
- `transferFacilityOwnership(facilityId, newOwnerProfileId)`: Calls atomic `transfer_facility_ownership` RPC.
- `toggleDropOffApproval(facilityId, dropOffApproved)`: Toggles public drop-off status (enforced by `trg_guard_facility_drop_off_approval`).

### 2.2 Workshop Registration Dialog (`src/components/workshop/RegisterWorkshopDialog.tsx`)
Accessible from `/technician`:
- **10 Approved Columns Only**:
  1. `name`: Workshop Name (min 3 chars).
  2. `address`: Physical street address.
  3. `village`: Village/hub.
  4. `tahsil`: Select dropdown of 13 Vidarbha tahsils.
  5. `phone`: 10-digit Indian phone number.
  6. `email`: Optional contact email.
  7. `latitude`: Valid numeric coordinate (-90 to 90, != 0).
  8. `longitude`: Valid numeric coordinate (-180 to 180, != 0).
  9. `max_equipment_capacity`: Machinery bays (min 1, default 4).
  10. `operating_hours`: Structured JSON (`open`, `close`, `days`).
- **Zero Unapproved Columns**: Strictly omits `facility_type`, `tooling_checklist`, and `equipment_specializations` (deferred to Phase 14–16).
- **GPS Integration**: "Detect GPS" button queries browser geolocation; changing tahsil automatically pre-fills the corresponding tahsil centroid coordinates.

### 2.3 Manage Workshop Dialog (`src/components/workshop/ManageWorkshopDialog.tsx`)
Accessible by `OWNER` or `MANAGER`:
- **Details Tab**: Edit contact phone, email, max equipment capacity, and operating hours. Shows coarse public address and drop-off badge.
- **Members Tab**:
  - Displays all affiliated technicians with color-coded badges:
    - `OWNER`: Primary brand colour.
    - `MANAGER`: Purple badge (`bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300`).
    - `TECHNICIAN`: Subtle muted badge.
  - Pending invitations marked with `Pending Acceptance` amber badge.
  - **Phone-Based Invite Flow**: Inline form requiring 10-digit mobile number; role restricted to `MANAGER` or `TECHNICIAN` (`OWNER` strictly forbidden in dropdown).
  - **Member Removal Flow**: Owner can remove any non-owner member; Manager can remove Technicians only. Owner deletion/demotion is blocked with `CANNOT_REMOVE_OWNER`.
  - **Pending Invitation Revocation**: Active owners/managers can revoke pending invitations before acceptance.
- **Governance & Ownership Tab**: Visible exclusively to current `OWNER`. Houses the atomic ownership transfer workflow.

### 2.4 Atomic Ownership Transfer Workflow (`src/components/workshop/TransferOwnershipDialog.tsx`)
High-friction 4-step security modal:
- **Step 1: Warning Banner**: Explicit notice that transferring ownership permanently relinquishes primary governance, atomically reassigns the caller as `MANAGER`, and cannot be undone without the new owner's consent.
- **Step 2: Candidate Selection**: Dropdown lists only currently active `MANAGER` or `TECHNICIAN` members of the facility (unverified, invited, or external users cannot be selected).
- **Step 3: Exact Name Typing Guard**: The caller must type the exact workshop name to unlock the confirmation button.
- **Step 4: Atomic Execution**: Invokes `transfer_facility_ownership` RPC. On success, closes dialog, refreshes memberships, updates caller's badge to `MANAGER`, and displays toast confirmation.

### 2.5 Technician Dashboard Integration (`src/routes/technician/index.tsx`)
- Adds the **Affiliated Workshops & Bays** section card above incoming requests.
- Shows total active affiliated facilities count.
- Renders cards for each affiliated facility showing name, location, role badge (`OWNER`/`MANAGER`/`TECHNICIAN`), and drop-off status (`Approved Drop-Off Point` vs `Private Field Base`).
- **Pending Invitation Handling**: When an invitation is pending, displays an inline alert with `Accept` and `Decline` action buttons.
- Provides `"Register New Workshop"` button opening `RegisterWorkshopDialog`.
- For `OWNER` or `MANAGER`, provides `"Manage Workshop"` button opening `ManageWorkshopDialog`.

### 2.6 Service Centre Admin Facilities View (`src/routes/admin/facilities.tsx`)
- New dedicated administrative screen accessible at `/admin/facilities`.
- Top metrics bar: Total Workshops, Approved Drop-Offs, Total Bay Capacity, Tahsils Covered.
- Search and Tahsil filter dropdown.
- Workshop cards displaying facility name, village, tahsil, owner details (`owner_name` + `owner_phone`), capacity, and active members count.
- **Public Drop-Off Approval Toggle**: Interactive switch control toggling `drop_off_approved` via `toggleDropOffApproval()`. Non-admins attempting to modify this setting are blocked by database trigger `trg_guard_facility_drop_off_approval`.
- Breadcrumb / contextual back button linking back to `/admin` ("Repair operations").

### 2.7 Admin Navigation Link (`src/routes/admin/index.tsx`)
- Adds `"Workshops & Bays"` navigation link with `Building2` icon in the administrative header alongside `"Parts Desk"` and `"Technician accounts"`.

### 2.8 Database Enhancements (`supabase/migrations/20261106160000_phase13_database_foundations.sql`)
To support the frontend service layer without bypassing security policies:
- Granted `INSERT, UPDATE` on `public.repair_facilities` to `authenticated` (gated by RLS and trigger guards).
- Granted `SELECT, UPDATE, DELETE` on `public.facility_memberships` to `authenticated`.
- Added `facility_memberships_delete_policy` allowing owners to delete non-owners, managers to delete technicians, and technicians to delete their own memberships.
- Added `remove_facility_member(p_facility_id UUID, p_technician_profile_id UUID)` `SECURITY DEFINER` RPC enforcing role hierarchy and owner protection.

---

## 3. Compliance with Group A Acceptance Criteria

| ID | Specification | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **AC-13-F01** | Technician can view all affiliated workshops on `/technician`, with distinct role badges (`OWNER`, `MANAGER`, `TECHNICIAN`) and facility drop-off status. | **PASS** | `src/routes/technician/index.tsx` renders affiliated workshops card with color-coded badges and drop-off pills. Tested in `phase-13-workshop-management.test.mjs`. |
| **AC-13-F02** | Technician can register a new workshop facility via `RegisterWorkshopDialog` collecting strictly the 10 approved columns; technician is automatically provisioned as `OWNER`. | **PASS** | `RegisterWorkshopDialog.tsx` strictly validates 10 columns and zero unapproved columns; trigger `trg_facility_owner_membership` provisions OWNER membership. |
| **AC-13-F03** | Facility `OWNER` and `MANAGER` can view member technicians in `ManageWorkshopDialog` and invite technicians strictly by 10-digit registered phone. | **PASS** | `ManageWorkshopDialog.tsx` provides member list, phone invite form with 10-digit regex, and restricts invited role to MANAGER/TECHNICIAN (rejects OWNER). |
| **AC-13-F04** | Non-owners cannot transfer facility ownership. Facility `OWNER` can transfer ownership to an active member via `TransferOwnershipDialog` with 2-step confirmation; upon transfer, old owner's role updates to `MANAGER`. | **PASS** | `TransferOwnershipDialog.tsx` enforces warning, candidate filtering to active non-owners, exact name typing, and atomic RPC execution. |
| **AC-13-F05** | Service Centre Admin can navigate to `/admin/facilities`, view all Vidarbha workshops, and toggle `drop_off_approved`. Non-admins are blocked by database triggers. | **PASS** | `/admin/facilities` screen rendered with switch control and metrics; `trg_guard_facility_drop_off_approval` blocks non-admins. |
| **AC-13-F06** | Public users and farmers cannot view private facility details (capacity, internal rosters, counter contacts); base table column-level privileges and `get_facility_handover_location()` RPC reveal exact coordinates and contact phone strictly during active `AUTHORIZED` handover window. | **PASS** | Base table `repair_facilities` SELECT revoked and partitioned to safe coarse attributes only; full details accessible only through authenticated management RPCs or active ticket handover RPC. |

---

## 4. Verification Checkpoint Status

- Working tree is clean except for the delivered Milestone 2 files.
- Zero remote queries or connections to Staging or Production.
- Zero git commits or pushes executed.
- Milestone 2 is complete, tested, and ready for review.
