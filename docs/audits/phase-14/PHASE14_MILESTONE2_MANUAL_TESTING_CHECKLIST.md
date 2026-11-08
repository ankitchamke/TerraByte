# Phase 14 Milestone 2 — Manual Verification Checklist & Acceptance Protocol

**Phase**: 14 (Smart Dispatch & Workshop Drop-Off)  
**Milestone**: M2 — Workshop-Origin OSRM Routing & Matching Integration (Option C: Qualification-First Ranking)  
**Document Status**: Canonical Manual Verification Protocol  
**Date**: 2026-11-08  
**Target Environment**: Local Test Stack (`127.0.0.1:8080` / `127.0.0.1:54332`) & Staging

---

## 1. Scope & Objectives

This protocol provides manual verification procedures to validate:
1. **Farmer Portal Technician Cards**: Real OSRM road distance, driving duration, and failure states.
2. **Admin Dispatch Candidate List & Assignment**: Elimination of hardcoded `45 min` defaults, qualification-first ranking (max 90), real OSRM road distance and ETA display.
3. **Technician Route Estimate Display**: Real-time estimate card rendering the mandatory rural traffic disclaimer.
4. **Missing Workshop Coordinates (`NO_COORDINATES`)**: Zero network calls, display of `Distance Unavailable`.
5. **Missing Farmer Breakdown Coordinates (`NO_COORDINATES`)**: Display of `Distance Unavailable`, zero network calls.
6. **OSRM Outage / Offline Simulation (`OUTAGE`)**: Non-disqualification, display of `Road Distance Temporarily Unavailable`, zero stale values.
7. **Extended Travel (> 50 km)**: `(Extended Travel)` badge display, no disqualification, no surcharge.
8. **Equal Qualification Scores & Deterministic Tie-Breaking**: 6-tier deterministic sorting hierarchy.

---

## 2. Prerequisites & Personas

### 2.1 Test Accounts & Credentials
All testing must utilize designated canonical demo personas:
- **Farmer Persona**: `farmer.nagpur@terrabyte.demo` (Role: `farmer`)
- **Technician Persona**: `tech.nagpur@terrabyte.demo` (Role: `technician`)
- **Admin Persona**: `admin.nagpur@terrabyte.demo` (Role: `admin` / `service_centre`)

### 2.2 Facility & GPS Fixtures
- **Registered Workshop 1 (Nagpur Service Centre)**: Latitude `21.1458`, Longitude `79.0882` (Facility ID: `00000000-0000-0000-0020-000000000001`).
- **Registered Workshop 2 (Wardha Rural Depot - Extended)**: Latitude `20.7453`, Longitude `78.6022` (~76 km from Nagpur).
- **Breakdown Location 1 (Katol Rural)**: Latitude `21.2825`, Longitude `78.5878` (Valid field breakdown).
- **Breakdown Location 2 (Null/Missing)**: Latitude `null`, Longitude `null` (Simulates missing GPS).

---

## 3. Test Scenarios & Step-by-Step Verification

### Scenario 1: Farmer Portal — Best-Matched Technicians with Real OSRM Route
- **Persona**: Farmer (`farmer.nagpur@terrabyte.demo`)
- **Navigation**: Login -> Farmer Dashboard -> Select unassigned repair ticket in `REQUESTED` status (e.g. `TB-7524`).
- **Steps**:
  1. Scroll to the **"Best-matched technicians"** section.
  2. Inspect each technician card (`TechCard`).
- **Expected Outcome**:
  - Distance and duration reflect actual OSRM road metrics (e.g. `14.2 km · ~28 min`).
  - No card displays the legacy hardcoded `0 km · ~45 min` placeholder.
  - Cards render Brand Match (e.g. "Mahindra specialist"), Skill Match ("Hydraulics expert"), and Availability ("Available now").
  - Qualification score reflects Option C: Maximum 90 points (zero proximity bonus added).
- **Negative Check**: Disconnect network or block OSRM domain; card must NOT display a blank space or broken NaN, but rather `Road Distance Temporarily Unavailable`.

---

### Scenario 2: Admin Dispatch — Candidate List & Assignment
- **Persona**: Admin (`admin.nagpur@terrabyte.demo`)
- **Navigation**: Login -> Admin Portal -> Select active unassigned repair request.
- **Steps**:
  1. Locate the **"Dispatch technician"** / **"Reassign technician"** card.
  2. Review the list of eligible verified technicians.
- **Expected Outcome**:
  - Each technician item displays the calculated OSRM road distance and duration (e.g. `18.4 km · ~34 min`).
  - Legacy `~45 min` hardcoded placeholder is completely absent.
  - Scores are displayed as qualification scores out of 90 (e.g. `score 90` or `score 70`).
  - Clicking **"Assign"** triggers the assignment workflow, displays toast confirmation, and updates repair status.

---

### Scenario 3: Technician Route Estimate Card & Rural Traffic Disclaimer
- **Persona**: Technician (`tech.nagpur@terrabyte.demo`)
- **Navigation**: Login -> Technician Portal -> Open assigned in-progress repair ticket.
- **Steps**:
  1. Locate the **Route Estimate Card**.
  2. Click **"Estimate driving distance and time"**.
- **Expected Outcome**:
  - Road Distance and Estimated Driving Time are rendered in bold metric cards.
  - Below the cards, the approved rural traffic disclaimer is rendered in italicized text:  
    `"Estimated standard driving duration. Real-time rural road and weather conditions may vary."`
  - Calculation timestamp is displayed.
  - The **"Recalculate"** button re-invokes the OSRM endpoint smoothly without page reload.

---

### Scenario 4: Missing Workshop Coordinates (`NO_COORDINATES`)
- **Persona**: Admin or Farmer viewing candidate list.
- **Fixture**: Technician profile with `primary_facility_id` set to null, or a facility with invalid coordinates (`0.0, 0.0`).
- **Steps**:
  1. Open candidate matching list for an active ticket.
  2. Locate the candidate without registered workshop GPS.
- **Expected Outcome**:
  - The technician card renders: `<MapPin /> Distance Unavailable`.
  - Browser DevTools Network tab verifies that **zero OSRM requests** (`router.project-osrm.org`) were issued for this candidate.
  - Candidate remains fully eligible and visible in the list.
  - The candidate receives their full qualification score (e.g. `score 90`).
  - The card does **not** display an outage message.

---

### Scenario 5: Missing Farmer Breakdown Coordinates (`NO_COORDINATES`)
- **Persona**: Admin or Farmer.
- **Fixture**: Repair ticket without an entry in `repair_dispatch_locations`.
- **Steps**:
  1. Navigate to the repair request detail page.
  2. Review eligible technicians list.
- **Expected Outcome**:
  - All technician cards render: `<MapPin /> Distance Unavailable`.
  - DevTools Network tab confirms **zero OSRM network requests** were issued.
  - All candidates retain their normal qualification rankings.
  - No errors or unhandled promise rejections occur in the console.

---

### Scenario 6: OSRM Outage / Network Timeout Simulation (`OUTAGE`)
- **Simulation**: In DevTools Network tab, add request blocking for `*router.project-osrm.org*` or throttle network to offline before loading technicians.
- **Steps**:
  1. Refresh the repair request matching view with OSRM blocked.
- **Expected Outcome**:
  - Cards render: `<MapPin /> Road Distance Temporarily Unavailable`.
  - Stale distance or ETA values from previous sessions are **never displayed** (`null` metrics).
  - All technicians remain 100% eligible for assignment.
  - Default candidate order is completely preserved (identical to online order).
  - Toast error does not spam the user interface.

---

### Scenario 7: Extended Travel (> 50 km)
- **Fixture**: Technician with registered workshop in Wardha Depot (~76 km from Katol field breakdown).
- **Steps**:
  1. Open candidate list containing the Wardha technician.
- **Expected Outcome**:
  - Card renders: `76.4 km · ~1 hr 35 mins (Extended Travel)`.
  - The `(Extended Travel)` label is styled with a distinct warning badge (`text-warning-foreground font-semibold`).
  - Candidate is **not disqualified**; the "Request" / "Assign" button remains active and clickable.
  - Zero fee surcharges or penalty deductions are added to the quote or score.

---

### Scenario 8: Equal Qualification Scores & Deterministic Tie-Breaking
- **Fixture**: Three technicians with identical qualification score (90 points):
  - Tech 1: Mahindra + Hydraulics (90 pts), Physical KYC Verified (`true`), Rating `4.9` (50 jobs).
  - Tech 2: Mahindra + Hydraulics (90 pts), Physical KYC Verified (`true`), Rating `4.2` (30 jobs).
  - Tech 3: Mahindra + Hydraulics (90 pts), In-person KYC Audit Pending (`false`), Rating `5.0` (10 jobs).
- **Steps**:
  1. Inspect the candidate list order.
- **Expected Outcome**:
  - **Rank 1**: Tech 1 (KYC true, 4.9 rating beats 4.2 rating).
  - **Rank 2**: Tech 2 (KYC true, beats Tech 3 who lacks physical KYC verification).
  - **Rank 3**: Tech 3 (KYC false, despite 5.0 rating).
  - Sorting is 100% deterministic across repeated page refreshes and portal viewports.

---

## 4. Evidence Capture Protocol

For audit sign-off, capture the following artifacts:
1. **Screenshot 1**: Farmer portal `TechCard` displaying real OSRM distance and duration without `45 min`.
2. **Screenshot 2**: Admin dispatch candidate list displaying real OSRM distance and extended travel badge.
3. **Screenshot 3**: Route estimate card rendering the mandatory rural traffic disclaimer.
4. **DevTools Log**: Network panel proving 0 network requests when workshop coordinates are missing (`NO_COORDINATES`).
5. **Console Log**: Clean console with 0 unhandled promise rejections during simulated OSRM outage.

---

## 5. Authorized Read-Only Staging QA Execution Results (2026-11-08)

On 2026-11-08, an authorized read-only manual QA execution was conducted against the dedicated staging Supabase environment (`ubqgvhcfmrvnmrbllcom.supabase.co`) via the local Vite staging server (`http://localhost:8081`).

### 5.1 Execution Results Summary

| Manual Check | Execution Result | Reason for Non-Execution |
| :--- | :---: | :--- |
| **Check 1: Farmer candidate routing, qualification ranking and extended travel** | **BLOCKED** | No existing active repair tickets exist for the staging farmer (`repairs = []`); all machinery is `Operational`. Creating a repair ticket is a prohibited staging write. |
| **Check 2: Technician route estimate and approved disclaimer** | **BLOCKED** | No existing assigned repair jobs exist for the staging technician (`assignedJobs = []`); canonical ticket `TB-8841` was cleaned up in prior sanitization. Assigning a job is a prohibited staging write. |
| **Check 3: OSRM outage through browser request blocking** | **BLOCKED** | Cascading dependency on Check 2; no live Route Estimate Card or unassigned candidate list was available in DOM to simulate an outage against staging data. |

### 5.2 Recorded Architectural & Security Facts
- **Staging Authentication Succeeded**: Both Farmer (`farmer.staging@terrabyte.app` -> Devdas Gaikwad) and Technician (`tech.staging@terrabyte.app` -> Santosh Kale) successfully authenticated via GoTrue (`/auth/v1/token?grant_type=password` returned HTTP 200 OK), and session profiles were resolved cleanly via `get_session_profile`.
- **Read-Only Access strictly Maintained**: Zero `INSERT`, `UPDATE`, `DELETE`, or `UPSERT` operations were dispatched to staging.
- **Zero Live OSRM Invocations**: No live OSRM network requests were made because no active repair records existed to initiate route computation.
- **Zero Business Data Mutation**: No technicians were assigned or reassigned; no breakdown reports were submitted; no quotes, notes, or parts requests were edited; and no `reset_demo_data()` or cleanup RPCs were called.
- **Zero Production Interaction**: The production project (`hwdrypkvszwrcraujctw`) was completely air-gapped and untouched.
- **Complete Teardown**: The local Vite development server and all headless Chrome processes were immediately stopped following verification.
- **Working Tree Preservation**: Git working-tree status remained 100% unchanged.
- **Milestone 3 Isolation**: Phase 14 Milestone 3 remains strictly unstarted.
- **Explicit Verdict Note**: Live OSRM integration is **NOT** claimed as manually verified in staging; all 3 manual checks are formally recorded as **BLOCKED** and logged in the Deferred QA Register below.

---

## 6. Explicit Deferred QA Register

The following follow-up manual verification items are permanently logged and must be executed either prior to final M2 QA closure or during an approved, isolated end-to-end QA cycle.

| Item ID | Title & Scope | Status | Reason | Required Prerequisite | Trigger & Gate | Restriction |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Deferred M2-QA-01** | **Farmer Candidate Routing & Option C Ranking**<br/>• Verify real OSRM road distance & ETA.<br/>• Verify Option C 90-pt qualification ranking independence.<br/>• Verify Extended Travel (> 50 km) tag.<br/>• Verify absence of `0 km / 45 min` default. | **DEFERRED** | Staging database contains 0 active repair requests for the staging farmer persona. | Obtain suitable existing test repair data in an isolated local environment or via an explicitly approved staging test-data plan. | Before final M2 QA closure or during approved isolated E2E cycle. | Zero staging business-data writes without separate explicit user authorization. |
| **Deferred M2-QA-02** | **Technician Route Estimate & Rural Disclaimer**<br/>• Verify Route Estimate Card rendering.<br/>• Verify exact disclaimer:<br/>*"Estimated standard driving duration. Real-time rural road and weather conditions may vary."*<br/>• Verify recalculation without page reload. | **DEFERRED** | Staging database contains 0 assigned repair jobs for the staging technician persona. | Obtain an existing assigned technician repair with exact breakdown coordinates in a safe test environment. | Before final M2 QA closure or during approved isolated E2E cycle. | Zero staging business-data writes without separate explicit user authorization. |
| **Deferred M2-QA-03** | **OSRM Outage Simulation via DevTools Blocking**<br/>• Block `*router.project-osrm.org*` in DevTools.<br/>• Verify `Road Distance Temporarily Unavailable`.<br/>• Verify stale metric purging.<br/>• Verify candidate eligibility & ranking preservation. | **DEFERRED** | No live candidate list or Route Estimate Card available due to zero active repairs on staging. | Access an existing active repair with valid coordinates in a safe test environment. | Before final M2 QA closure or during approved isolated E2E cycle. | Zero database modifications to simulate outage; DevTools network blocking only. |
| **Deferred M2-QA-04** | **Staging Technician Identity Reconciliation**<br/>• Reconcile staging persona (*Santosh Kale*, `tech.staging@terrabyte.app`) with production demo persona (*Ramesh Kumar*, `tech.nagpur@terrabyte.demo`).<br/>• Document the verified auth-to-profile mapping across staging and production. | **DEFERRED** | Discrepancy identified between local seed persona name (*Ramesh Kumar*) and staging synthetic persona name (*Santosh Kale*). | Inspect repository staging auth migration (`20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql`) and `PRODUCTION_REPLACEMENT_DISCOVERY.md`. | Before final M2 QA closure. | Zero authentication or query requests to remote Supabase during documentation audit. |

> [!IMPORTANT]
> **Persistence Rule**: When Phase 14 M2 is formally signed off by the user, these deferred items must **NOT** be silently checked off or marked complete. If M2 sign-off proceeds based on the 100% passing automated test suite (`tests/phase-14-routing-and-matching.test.mjs` and `tests/route-estimate.test.mjs`), these 4 items remain recorded as accepted/deferred follow-up tasks in this register.

---

## 7. Milestone Sequence, M3 Start Gate & Production Migration Timing

### 7.1 Authoritative Milestone Execution Sequence
1. **Phase 14 Milestone 1 — Database Foundation & Domain Invariants**: **FORMALLY SIGNED OFF** (Live PostgreSQL 17.6 integration tests verified).
2. **Phase 14 Milestone 2 — Workshop-Origin OSRM Routing & Matching Integration**: **FORMALLY SIGNED OFF** (Automated implementation & verification verified across 36 tests; formal user approval granted; 3 blocked live staging checks remain deferred and tracked under Section 6 Deferred QA Register).
3. **Phase 14 Milestone 3 — Farmer Intake Wizard Dual Delivery & Immobile Machinery Lock**: **AUTHORIZED TO IMPLEMENT — IN PROGRESS** (Formally unblocked and authorized following M2 user approval; implementation in progress; completion and sign-off pending separate user review).
4. **Phase 14 Milestone 4 — Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy**: **NOT STARTED**.
5. **Phase 14 Milestone 5 — Multi-Role Integration, Regression & QA**: **NOT STARTED**.
6. **Phase 16 — Frontend UI/UX Polish, Modernization & Full Responsiveness**: **PLANNED**.
7. **Phase 17 — System QA, Production Migration, Data Replacement and Release Gate**: **PLANNED RELEASE GATE**.

### 7.2 Phase 14 M3 Start Gate & Authorization Status
- **Milestone 2 Sign-Off Granted**: The user has formally approved Phase 14 Milestone 2 based on verified automated tests and documented staging constraints.
- **Milestone 3 Implementation Authorized**: Milestone 3 is formally unblocked, authorized to implement, and currently in progress. It is no longer gated on M2 approval.
- **Traceability & Non-Completion Guarantee**: The four deferred QA items in Section 6 (`Deferred M2-QA-01` through `M2-QA-04`) remain active and must **NOT** be marked complete. Milestone 3 implementation is in progress and has not yet been completed or signed off.
- **Migration Decoupling**: Milestone 3 implementation proceeds directly in the current workspace without waiting for Phase 17 production migration.

### 7.3 Production Migration Release Gate Invariant
- **Timing**: Production database migrations and production cutover are planned strictly for **Phase 17**, *after* Phase 14 M3–M5 and Phase 16 are fully completed and verified.
- **Constraint**: Zero production or staging database migrations are to be executed during Phase 14 milestone preparation.
