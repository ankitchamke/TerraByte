# TerraByte — Phase 14 Milestone 5: Manual Testing Checklist
## Manual Technician Dispatch & Reassignment

**Document Reference**: `docs/audits/phase-14/PHASE14_MILESTONE5_MANUAL_TESTING_CHECKLIST.md`  
**Date**: November 9, 2026  
**Status**: Ready for QA / User Acceptance  
**Environment**: Local Development Server (`localhost:8080`), Local Supabase DB (`127.0.0.1:54332`)

---

## Prerequisites
1. Local development server is running (`npm run dev`).
2. Local database container is healthy and migrated (`20261109000000_phase14_m5_manual_dispatch_and_reassignment.sql` applied).
3. Demo data seeded with Service Centre Admin (`admin@demo.com`), Farmer (`farmer@demo.com`), and at least 2 verified technicians (`tech1@demo.com`, `tech2@demo.com`).

---

## Test Cases

### TC-M5-01: Admin Candidate Inspection & Decision Support
- [ ] Log in as Service Centre Administrator (`/admin`).
- [ ] Navigate to an open repair request (`/admin/repair/:id`).
- [ ] Scroll down to the **Dispatch / Reassignment** section.
- [ ] Verify that candidate technicians are listed with:
  - Full name and workshop name.
  - Composite qualification score (e.g. `score 85`).
  - Compatibility badges: `Brand Expert` (if tractor make matches), `Skill Match` (if issue matches skills), `Available`.
  - OSRM Road Distance & ETA (e.g. `14.2 km · ~28 min`).
  - `(Extended Travel)` indicator if road distance exceeds 50 km.

### TC-M5-02: Initial Technician Dispatch
- [ ] On an unassigned repair request (`technician_id = null`), click **Dispatch** next to candidate technician A.
- [ ] Verify the modal dialog opens with:
  - Title: **Dispatch Technician**.
  - Candidate summary card showing qualifications and route estimate.
  - Field: **Dispatch Notes / Reason (Optional)**.
  - Primary button: **Confirm Dispatch**.
- [ ] Optionally enter a note (e.g. "Immediate morning dispatch").
- [ ] Click **Confirm Dispatch**.
- [ ] Verify toast confirmation: `Dispatched [Technician Name] to repair [Job Number].`
- [ ] Verify the repair ticket updates to display the assigned technician.
- [ ] Verify the **Technician Assignment History** card renders an entry:
  - Badge: `Initial Dispatch`.
  - Actor: `By [Admin Name] (admin)`.
  - Detail: `Assigned to [Technician Name]`.
  - Timestamp matching current time.

### TC-M5-03: Mandatory Reassignment Reason Enforcement
- [ ] On the already assigned repair request, locate candidate technician B in the candidate list.
- [ ] Verify the action button now displays **Reassign**.
- [ ] Click **Reassign**.
- [ ] Verify the modal dialog opens with:
  - Title: **Reassign Technician**.
  - Description: `Reassign repair ticket [Job Number] from [Technician A] to [Technician B].`
  - Field: **Reason for Reassignment \*** with a red required asterisk.
  - Primary button: **Confirm Reassignment** (disabled while reason is empty).
- [ ] Leave the reason field blank and attempt to submit.
- [ ] Verify submission is blocked and a validation error is displayed: *"A mandatory explanation/reason is required when reassigning a technician."*
- [ ] Enter a whitespace-only string (e.g. spaces); verify button remains disabled or blocks submission.

### TC-M5-04: Successful Technician Reassignment
- [ ] Enter a valid operational reason: `"Technician A had an urgent vehicle breakdown. Reassigning to Technician B for same-day inspection."`
- [ ] Click **Confirm Reassignment**.
- [ ] Verify toast confirmation: `Reassigned repair to [Technician B]. Notifications sent.`
- [ ] Verify the repair ticket reflects Technician B as the active technician.
- [ ] Verify the **Technician Assignment History** card updates immediately with a second entry:
  - Badge: `Reassignment` (amber).
  - Actor: `By [Admin Name] (admin)`.
  - Transition: `[Technician A] → [Technician B]`.
  - Quoted reason: `"Technician A had an urgent vehicle breakdown. Reassigning to Technician B for same-day inspection."`

### TC-M5-05: Dynamic Multi-Table RLS Boundary on Reassignment
- [ ] In an incognito window, log in as Technician B (`/technician`).
- [ ] Open the active job queue or navigate to `/technician/job/:id`.
- [ ] Verify Technician B can view:
  - Repair ticket details (`repair_requests`)
  - Farmer GPS and dispatch location (`repair_dispatch_locations`)
  - Operational history (`repair_timeline`)
  - Assignment history (`repair_assignment_history` & `get_repair_assignment_history`)
  - Quotes and quote items (`quotes`, `quote_items`)
  - Parts requests (`service_centre_part_requests`)
- [ ] In another window, log in as Technician A (former technician).
- [ ] Navigate to `/technician/job/:id` for the reassigned repair.
- [ ] Verify Technician A is completely blocked:
  - Cannot view repair ticket (0 rows returned)
  - Cannot view dispatch locations, notes, or timeline (0 rows returned)
  - Cannot view or manage quotes or line items (0 rows returned)
  - Cannot view part requests (0 rows returned)
  - Calling `get_repair_assignment_history` returns `42501 Permission Denied`.

### TC-M5-06: Duplicate Assignment Guard
- [ ] Return to `/admin/repair/:id`.
- [ ] Verify that currently assigned Technician B is either filtered out from the candidates list or any attempt to dispatch to Technician B is rejected with a duplicate assignment warning.

### TC-M5-07: Concurrency & Optimistic Concurrency Control (OCC)
- [ ] Open the same repair request in two separate browser tabs (Tab 1 and Tab 2).
- [ ] In Tab 1, reassign the ticket to Technician C.
- [ ] In Tab 2 (which still displays Technician B as current), attempt to reassign to Technician D.
- [ ] Verify Tab 2 displays a conflict error: *"The repair assignment was modified by another dispatcher. Please refresh."*
- [ ] Refresh Tab 2; verify Technician C is displayed.

### TC-M5-08: Farmer Technician Nomination on Unassigned Request
- [ ] Log in as Farmer (`/farmer`).
- [ ] Navigate to an unassigned repair request in `REQUESTED` status (`/farmer/repair/:id`).
- [ ] Verify the farmer can view verified candidate technicians.
- [ ] Click to request/nominate Technician A.
- [ ] Verify that `farmer_request_technician` RPC successfully assigns Technician A.
- [ ] Verify `repair_assignment_history` records `assigned_by_role = 'farmer'`, `assignment_type = 'DISPATCH'`.
- [ ] Attempt as farmer to reassign the technician once assigned; verify the UI disallows reassignment and direct client calls are rejected.

### TC-M5-09: Explicit Lifecycle Transition Allowlist & Handover Protection
- [ ] Log in as Administrator (`/admin`).
- [ ] Navigate to a completed repair (`status = 'COMPLETED'`) or cancelled repair (`status = 'CANCELLED'`).
- [ ] Verify dispatch/reassign actions are disabled or blocked with error: *"Cannot assign or reassign technician on a COMPLETED/CANCELLED repair request."*
- [ ] Navigate to a repair with handover authorized or released (`handover_status IN ('AUTHORIZED', 'RELEASED')`).
- [ ] Verify dispatch/reassign is rejected with error: *"Cannot assign or reassign technician when equipment handover is AUTHORIZED/RELEASED."*
- [ ] Verify initial dispatch on unassigned non-REQUESTED repair is blocked with error: *"Initial dispatch is only permitted on repair in REQUESTED status."*

### TC-M5-10: Invariant Non-Bypass Gate
- [ ] Verify that reassigning a technician to an active repair (`ACCEPTED`, `IN_PROGRESS`, `WAITING_FOR_PARTS`) preserves the existing repair status.
- [ ] Verify that reassignment does not reset, modify, or bypass `load_test_passed`, `payment_status`, or handover state.

---

## Active Deferred QA Tracking
The following items remain active and deferred to Phase 17 staging:
- [ ] **Deferred M2-QA-01**: Staging PostGIS topology extension activation (`ubqgvhcfmrvnmrbllcom`).
- [ ] **Deferred M2-QA-02**: Real-world rural road distance validation on Vidarbha corridors.
- [ ] **Deferred M2-QA-03**: OSRM public demo server rate-limit fail-open resilience in production.
- [ ] **Deferred M2-QA-04**: Verification of spatial coordinates with zero remote staging mutations.
