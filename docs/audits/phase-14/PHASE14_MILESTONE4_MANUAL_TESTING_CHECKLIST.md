# TerraByte — Phase 14 Milestone 4 Manual Testing Checklist
## Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy

- **Audit Date**: 2026-11-08
- **Phase**: Phase 14 (Smart Dispatch, Location Capture & Service Delivery Routing)
- **Milestone**: Milestone 4 (Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy)
- **Status**: READY FOR MANUAL QA (GATED PENDING AUTHORIZED REVIEW)
- **Database Target**: Local Isolated Environment (`127.0.0.1:54332`) / Read-Only Mocked Staging

---

## 1. Executive Summary & Boundary Invariants

Milestone 4 implements the complete operational lifecycle of machinery arriving at approved TerraByte workshops across the 13 tahsils of the Nagpur/Vidarbha region.

### Core Architectural Invariants
1. **Separation of Physical Occupancy from Reservations**:
   - `physical_occupancy` tracks machinery physically present in workshop bays (`dropped_off_at IS NOT NULL AND handover_status != 'RELEASED'`).
   - `active_reservations` tracks machinery in transit under unexpired reservations (`status = 'RESERVED' AND expires_at > NOW()`).
   - `total_committed_capacity = physical_occupancy + active_reservations`.
2. **Cancellation Independence**:
   - Cancelling a repair ticket does **NOT** reduce physical bay occupancy if the equipment has already been dropped off.
   - Physical occupancy is released **only** when authorized workshop staff explicitly records physical customer collection via `release_cancelled_workshop_equipment`.
3. **Dual Path Check-In**:
   - **Path A (Active Reservation Claim)**: Equipment with an active unexpired reservation claims its allocated bay and receives a unique receipt `RCP-TB-YYYYMMDD-XXXX`.
   - **Path B (Standby Arrival)**: Walk-in equipment without an active reservation checks in only if uncommitted bay capacity exists, claiming an available bay.
4. **FIFO Priority Preservation Across Rerouting**:
   - Rerouting a reservation to another approved workshop preserves the ticket's original `reserved_at` timestamp in `priority_original_reserved_at`.
5. **Renewal Guardrails**:
   - Farmers are restricted to **exactly 1 self-renewal** (+24 hours). Subsequent extensions are rejected.
   - Administrators can grant additional extensions, but **mandatory audit notes** are strictly required and logged.

---

## 2. Deferred Phase 14 Milestone 2 Manual QA Items (Carried Forward)

Per Phase 14 formal sign-off protocol, the four deferred M2 live staging checks remain active and are preserved here:

- [ ] **M2-QA-01 (DEFERRED)**: Live Staging Candidate List Ranking with Real GPS (Blocked: Staging DB had 0 active repair tickets for farmer).
- [ ] **M2-QA-02 (DEFERRED)**: Technician Job Route Estimate Card with OSRM (Blocked: Staging DB had 0 assigned jobs for technician).
- [ ] **M2-QA-03 (DEFERRED)**: Public OSRM Outage Graceful Degradation (Blocked: Dependent on live candidate matching view).
- [ ] **M2-QA-04 (DEFERRED)**: Manual Re-center & GPS Drift Verification on Device (Requires live outdoor mobile hardware).

---

## 3. Milestone 4 Manual QA Test Scenarios

### Scenario 1: Workshop Operations Desk — Capacity & Utilization Overview
- **Account / Role**: Service Centre Admin (`admin@terrabytelabs.com`)
- **Route**: `/admin/facilities`
- **Action**:
  1. Navigate to `/admin/facilities`.
  2. Locate any approved drop-off facility card (e.g., *Kalmeshwar Agro Workshop*).
  3. Click **"Workshop Operations Desk"**.
- **Expected Results**:
  - Modal/dialog opens with facility name, manager contact, and operating hours.
  - Utilization progress bar renders with committed bays vs max bays.
  - Quick metric pills display: *Max Bays*, *In Bays Now*, *Active Reserved*, and *Available*.
  - Status badge displays **"Bays Available"** (green), **"At Capacity"** (amber), or **"Overcommitted"** (red).

---

### Scenario 2: Active Reservation Pre-Arrival View & Farmer 1x Self-Renewal
- **Account / Role**: Farmer (`farmer@terrabytelabs.com`)
- **Route**: `/farmer/repair/:id` (for a ticket with `delivery_mode = 'WORKSHOP_DROPOFF'`)
- **Action**:
  1. Open the repair ticket.
  2. Inspect the **Workshop Drop-Off Location & Details** card.
  3. Verify workshop name, address, phone, and **Bay Reservation** countdown (*"Bay reservation expires in..."*).
  4. Click **"Extend Bay Reservation"** button.
- **Expected Results**:
  - Toast notification appears: *"Reservation extended successfully"*.
  - Expiration time updates by +24 hours.
  - Renewal count indicates `(Extended 1x)`.
  - The extend button disappears and is replaced by helper text: *"Self-renewal limit reached (1x). Contact workshop staff if extra time is needed."*

---

### Scenario 3: Admin Reservation Extension with Mandatory Audit Notes
- **Account / Role**: Service Centre Admin (`admin@terrabytelabs.com`)
- **Route**: `/admin/repair/:id` or `/admin/facilities` (Operations Desk -> Reservations tab)
- **Action**:
  1. Locate the incoming reservation.
  2. Click **"Admin Extend Reservation"** (or **"Extend"**).
  3. Select duration (+24 Hours).
  4. Attempt to submit with empty audit notes.
  5. Fill in mandatory note: *"Farmer reported tractor transport breakdown on highway; granted 24h weather delay."*
  6. Click **"Confirm Extension"**.
- **Expected Results**:
  - Empty note submission is blocked with validation error.
  - Valid submission extends `expires_at` and records the audit note in the timeline and reservation audit record.

---

### Scenario 4: Physical Equipment Check-In (Path A: Active Reservation)
- **Account / Role**: Service Centre Admin or Workshop Lead
- **Route**: `/admin/repair/:id` or `/admin/facilities` (Operations Desk -> Reservations tab)
- **Action**:
  1. Locate the active reservation.
  2. Click **"Check In Equipment"**.
  3. Enter optional condition note: *"Tractor arrived via flatbed trolley. Keys with shop foreman. Minor scrape on front bumper."*
  4. Click **"Confirm Physical Check-In"**.
- **Expected Results**:
  - Success screen displays: *"Check-In Completed"*.
  - A unique formatted custody receipt number is displayed: `RCP-TB-YYYYMMDD-XXXX`.
  - Check-in mode badge displays: **"Active Reservation Claimed"**.
  - Drop-off timestamp is recorded.
  - The reservation transitions from `RESERVED` to `CLAIMED`.
  - Workshop bay physical occupancy increments by 1.

---

### Scenario 5: Printable Custody Receipt Modal Verification
- **Account / Role**: Admin (`admin@terrabytelabs.com`) or Farmer (`farmer@terrabytelabs.com`)
- **Route**: `/admin/repair/:id` or `/farmer/repair/:id` (on checked-in ticket)
- **Action**:
  1. Click **"View / Print Custody Receipt"** (or **"View Custody Receipt"**).
  2. Inspect the displayed custody receipt.
  3. Click **"Print Receipt"**.
- **Expected Results**:
  - Modal opens titled *"Custody & Intake Receipt"*.
  - Displays: Official header, Receipt Number `RCP-TB-...`, Equipment details (Make/Model/SN), Job Number, Farmer details, Workshop details, Receiving Staff, and Condition notes.
  - Custody legal acknowledgement paragraph is rendered.
  - Browser print dialog triggers cleanly with print-optimized CSS hiding UI chrome.

---

### Scenario 6: Standby Arrival (Path B: No Prior Reservation)
- **Account / Role**: Service Centre Admin / Workshop Staff
- **Route**: `/admin/facilities` (Operations Desk -> Standby / Expired tab) or `/admin/repair/:id`
- **Action**:
  1. Select a repair ticket with an expired reservation or walk-in status without prior reservation.
  2. Click **"Attempt Standby Check-In"** (or **"Check In Equipment"**).
  3. Enter notes and confirm.
- **Expected Results**:
  - If open bays exist, check-in succeeds.
  - Receipt `RCP-TB-YYYYMMDD-XXXX` is issued.
  - Mode indicates **"Standby Arrival Accepted"**.
  - A new claimed reservation record is created.
  - Workshop physical occupancy increments by 1.

---

### Scenario 7: Workshop Bay Downsizing & Capacity Rejection
- **Account / Role**: Service Centre Admin (`admin@terrabytelabs.com`)
- **Route**: `/admin/facilities` (Operations Desk -> Overview tab)
- **Action**:
  1. Click **"Change Capacity"** on a workshop with 2 physical machines in bays.
  2. Reduce capacity to 2 bays.
  3. Save capacity.
  4. Inspect the capacity indicators.
  5. Attempt to check in a 3rd standby walk-in machine.
- **Expected Results**:
  - Capacity updates to 2 bays; status shows **"At Capacity"** (amber).
  - Existing machinery is NOT evicted.
  - Standby check-in attempt is rejected with code `CAPACITY_EXHAUSTED` and message: *"Check-in Rejected: All physical machine bays at this facility are currently occupied."*
  - Rejection notice offers reroute option to another approved workshop.

---

### Scenario 8: FIFO Priority Preservation Across Workshop Rerouting
- **Account / Role**: Service Centre Admin (`admin@terrabytelabs.com`)
- **Route**: `/admin/repair/:id` or Operations Desk
- **Action**:
  1. Open a pre-arrival ticket with an active reservation.
  2. Note the original `reserved_at` creation time.
  3. Click **"Reroute to Different Workshop"** (or **"Reroute"**).
  4. Select a different approved facility from the dropdown.
  5. Confirm reroute.
- **Expected Results**:
  - Ticket updates to new facility reference.
  - Reservation at new facility is created with `priority_original_reserved_at` exactly matching the original reservation timestamp.
  - In the new facility's Operations Desk, the ticket ranks ahead of newer incoming drop-offs in FIFO priority.

---

### Scenario 9: Cancelled Ticket in Bay & Explicit Authorized Physical Release
- **Account / Role**: Service Centre Admin (`admin@terrabytelabs.com`)
- **Route**: `/admin/repair/:id` and `/admin/facilities` (Operations Desk -> Equipment In Bays tab)
- **Action**:
  1. Open a checked-in repair ticket that is physically occupying a bay.
  2. Cancel the repair request (via farmer cancellation or admin action).
  3. Inspect `/admin/repair/:id`: verify the prominent Amber banner **"Cancelled Equipment Physically Occupying Bay"**.
  4. Inspect `/admin/facilities`: verify physical occupancy is **still held** (not freed).
  5. Click **"Record Equipment Physical Release"**.
  6. Enter release notes: *"Farmer arrived with tractor trolley to collect machine. Keys returned."*
  7. Confirm physical release.
- **Expected Results**:
  - Repair request updates to `handover_status = 'RELEASED'` and records `handover_released_at`.
  - In `/admin/facilities`, the physical occupancy decrements by 1 and available bays increment by 1.
  - Equipment is removed from the active in-bay list.

---

### Scenario 10: Technician Job View Badging
- **Account / Role**: Assigned Field Technician (`technician@terrabytelabs.com`)
- **Route**: `/technician/job/:id`
- **Action**:
  1. Open an assigned repair job with `delivery_mode = 'WORKSHOP_DROPOFF'`.
  2. Inspect the header and job status banner.
- **Expected Results**:
  - Workshop Drop-Off badge is displayed: `"Workshop Drop-Off"`.
  - If dropped off: Green badge indicates `"In Workshop Custody · Receipt: RCP-TB-YYYYMMDD-XXXX"`.
  - If awaiting drop-off: Amber badge indicates `"Awaiting Drop-Off Arrival"`.
  - If ticket is cancelled while in bay: Amber warning indicates `"Cancelled Equipment In Workshop Bay: Do not release equipment to owner without Service Centre authorization."`

---

## 4. Sign-Off Governance

| Review Item | Requirement | Status |
|---|---|---|
| Automated Live PostgreSQL Tests | `tests/phase-14-m4-dropoff-lifecycle.test.mjs` (9/9 pass) | PASS |
| Regression Protection | `tests/phase-13-milestone6-integration-e2e.test.mjs` (16/16 pass) | PASS |
| Trilingual Parity | EN / HI / MR dictionaries contain 270 keys each with 100% parity | PASS |
| Remote Isolation | Zero writes to staging `ubqgvhcfmrvnmrbllcom` or production `hwdrypkvszwrcraujctw` | VERIFIED |
| Deferred M2 QA Items | All 4 items (`M2-QA-01` to `M2-QA-04`) preserved and active | PRESERVED |
| Milestone 4 Sign-Off | Explicit user review and authorization required | PENDING USER REVIEW |
