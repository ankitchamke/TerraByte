# TerraByte — Project State

## Current Phase
- **Phase 1 — Wireframing & UX Specification** (Completed)

## Current Goal
Establish a clear, implementation-ready UX blueprint and information architecture for TerraByte's core repair coordination workflow before any production code or database infrastructure is built.

---

## Product Summary
**TerraByte** is a digital agricultural equipment repair ecosystem that coordinates the complete journey from equipment breakdown to completed repair.

- **Central Product Outcome**: **REDUCE THE TIME BETWEEN EQUIPMENT BREAKDOWN AND GETTING BACK TO WORK.**
- **Positioning**: TerraByte is **not** a generic mechanic marketplace. It is an end-to-end repair operating system coordinating intake, assistive diagnostic assessment, qualified technician assignment, transparent quotation, live repair status tracking, and permanent equipment service history.
- **Core Workflow**:
  ```
  Equipment Selection 
  → Breakdown Report (Symptoms + Photo)
  → Initial Assessment (Assistive AI)
  → Suitable Technician Selection (Expertise-first)
  → Repair Requirements & Transparent Quote
  → Farmer Quote Approval
  → Live Repair Tracking (with parts blocker visibility)
  → Completion & Verification
  → Permanent Equipment Service History Logged
  ```

---

## Locked Decisions
1. **Repository as Source of Truth**: All progress, state, and specifications live inside this repository.
2. **Phase Boundary Discipline**: Phase 1 is strictly UX architecture and wireframing. Zero production code, zero schema definitions, zero API calls, and zero external services deployed in Phase 1.
3. **Single Documentation File**: All UX specs, flows, status models, and wireframes reside in `PROJECT_STATE.md`. No detached planning folders or auxiliary spec files.
4. **Assistive AI Role**: AI serves strictly as an assistive diagnostic intake tool (translating natural-language symptoms and images into preliminary mechanical hypotheses and part categories). It is never presented as an infallible automated mechanic.
5. **No Fabricated Real-World Claims**: Simulated or demo seed data (technicians, inventory, FPO connections) must always be explicitly labeled as `DEMO DATA`. Never claim unverified field validation or fake user traction.
6. **Service History Belongs to Equipment**: Service records are bound to the equipment asset entity, not merely stored as isolated past invoices, preserving machine resale value and recurring maintenance context.

---

## Tech Stack
The production application stack is locked and will be implemented in subsequent phases:

| Layer | Technology |
|---|---|
| **Frontend Framework** | React (SPA) + Vite |
| **Styling & Design System** | Tailwind CSS |
| **Backend & Database** | Supabase (PostgreSQL) |
| **Authentication** | Supabase Auth (Phone OTP / Email) |
| **Object Storage** | Supabase Storage (Equipment & breakdown photos) |
| **Server-Side AI** | Supabase Edge Functions + Google Gemini API |
| **Hosting & Deployment** | Vercel |
| **Version Control** | GitHub |
| **Primary Development Environment** | Google Antigravity |

---

## User Roles

### 1. Farmer (Primary User)
- **Mindset**: Anxious, time-sensitive, working in outdoor or low-bandwidth field environments, wary of hidden repair costs or unqualified mechanics.
- **Primary Need**: "My tractor is dead in the field during harvest. Tell me what's wrong, who can fix it properly today, what it will cost, and when it will run again."
- **Key UX Tenet**: Plain language (no robotic or academic jargon like "triage"), high contrast, single primary call-to-action per screen, 1-tap phone calls to assigned technician.

### 2. Field Technician (Service Provider)
- **Mindset**: Hands on tools, mobile-first, needs concise actionable technical information without administrative overhead.
- **Primary Need**: "What equipment model is this? What are the symptoms? What parts should I put in my truck before driving out? Send a quote, get it approved fast, log progress, get paid."
- **Key UX Tenet**: High information density on breakdown details, clear accept/decline actions, fast 3-field itemized quotation tool, one-touch status toggle.

### 3. Service Centre / Admin (Dispatcher & Oversight)
- **Mindset**: Operational coordinator monitoring SLA compliance, unassigned bottlenecks, spare parts availability, and technician load.
- **Primary Need**: "Are any breakdown requests sitting unaccepted? Are any repairs stalled waiting for parts? Intervene where needed."
- **Key UX Tenet**: Exception-driven dashboard (highlighting blocked/stalled jobs), technician load overview, manual reassignment capability.

---

## Core Flows

### Flow A — Farmer Breakdown Intake & Initial Assessment
1. **Entry Point**: Farmer taps **[Report Breakdown]** from Home or directly from Equipment card.
2. **Step 1: Select Equipment**:
   - Selects machine from registered fleet (e.g., *Mahindra 575 DI*) or taps *Quick Add Machine*.
3. **Step 2: Describe Issue**:
   - Primary symptom selector (Engine won't crank, Hydraulic lift stuck, Black smoke, Transmission slipping, Overheating, Other).
   - Plain-language description input (voice-dictation friendly placeholder).
   - Optional photo/video upload (camera capture optimized).
4. **Step 3: Initial Assessment (Assistive AI)**:
   - System presents plain-language breakdown summary:
     - Likely affected system (e.g., "Fuel injection system / clogged filter").
     - Urgency rating (e.g., "High — Do not run engine to prevent pump seizure").
     - Likely needed parts category (e.g., "Inline fuel filter, feed pump seal").
5. **Step 4: Technician Matching**:
   - System displays qualified technicians filtered by **Equipment Brand Experience** and **Problem Category Expertise**, not just raw GPS proximity.
   - Shows technician qualification badge, approximate distance, and equipment experience.
   - Farmer taps **[Request Repair]**.
6. **System Response**: Job status set to `REQUESTED`. Push/SMS alert queued for technician. Transition to Live Repair Hub.

### Flow B — Technician Job Review & Acceptance
1. **Entry Point**: Incoming repair notification or Technician Job Feed.
2. **Review Screen**:
   - Technician reviews: Equipment make/model/year, farmer location, reported symptoms, farmer photos, assistive assessment hypothesis.
3. **Decision Point**:
   - **Accept Job**: Status updates to `ACCEPTED`. Farmer is notified with technician ETA and contact details.
   - **Decline Job**: Technician selects quick reason (Out of service area, Wrong specialization, Fully booked). Request re-enters matching queue or alerts Admin.

### Flow C — Transparent Quotation & Farmer Approval
1. **Technician Inspection & Quote Formulation**:
   - Upon remote assessment or physical site visit, technician taps **[Create Repair Quote]**.
   - Fills itemized fields:
     - Replacement Parts (Part Name, Est. Cost, Source availability).
     - Labour / Service Charges.
     - Estimated Completion Time / Handover Date.
   - Taps **[Send Quote to Farmer]**.
2. **System Response**: Job status transitions to `QUOTE_PENDING`.
3. **Farmer Quote Review**:
   - Farmer receives prominent notification and opens Repair Hub.
   - Views transparent cost breakdown: `Parts Subtotal + Labour + Taxes = Total Payable`.
   - Clear note: *No work begins without your approval.*
4. **Decision Point**:
   - **Approve Quote**: Farmer taps **[Approve & Authorize Repair]**. Status advances immediately to `IN_PROGRESS`.
   - **Request Clarification / Decline**: Farmer taps **[Call Technician to Discuss]** or **[Decline Quote]** (with optional note). Technician can adjust line items and resubmit.

### Flow D — Live Repair Tracking & Blocker Visibility
1. **Execution Tracking**:
   - Linear step progress indicator: `Request Sent → Accepted → Quote Approved → Work in Progress → Testing → Ready`.
2. **Part Bottleneck Handling**:
   - If technician is blocked waiting for a component, technician taps **[Mark: Waiting for Parts]** and inputs expected arrival date (e.g., "Waiting on Hydraulic Hose from District Dealer — Expected Tomorrow 11 AM").
   - Status updates to `WAITING_FOR_PARTS`.
   - Farmer dashboard immediately reflects this state with clear explanation, mitigating anxiety and eliminating repetitive phone calls.
3. **Resumption**: When part arrives, technician toggles back to `IN_PROGRESS`.

### Flow E — Completion & Equipment Service History
1. **Completion**:
   - Technician completes repair, conducts test run, uploads optional completion photo, and taps **[Mark Repair Completed]**.
   - Status updates to `COMPLETED`.
2. **Verification & Farmer Sign-Off**:
   - Farmer verifies equipment operation.
   - Digital handover confirmation recorded.
3. **Service History Logging**:
   - The job automatically compiles into an immutable **Equipment Service Record** linked directly to that machine's serial/chassis profile:
     - Date & Operating Hours
     - Replaced Parts & Invoice Record
     - Technician Name & Workshop
     - Root Cause & Maintenance Advice
   - Increases machine resale value and feeds future diagnostic context.

### Flow F — Admin Oversight & Intervention
1. **Dispatch Monitoring**:
   - Admin monitors the active board. Any job in `REQUESTED` state for > 30 minutes without acceptance triggers an amber visual flag.
2. **Manual Intervention**:
   - Admin can manually reassign an unaccepted or stalled job to another certified partner workshop.
   - Can verify parts sourcing lead times for jobs marked `WAITING_FOR_PARTS`.

---

## Current UX / Screen Architecture

To maximize development velocity and eliminate navigational clutter, TerraByte combines fragmented sub-screens into **4 unified core screens for Farmers**, **2 focused workspaces for Technicians**, and **1 operational console for Admin**.

```
[ GLOBAL / AUTH ]
       │
       ├── Farmer ────► 1. Farmer Home (Active repair banner + Quick breakdown button)
       │                 ├── 2. Equipment Fleet & Service Record (Machines + History)
       │                 ├── 3. Breakdown Intake & Assessment Wizard (Report + AI + Match)
       │                 └── 4. Live Repair & Quote Hub (Quote review, live tracking, completion)
       │
       ├── Technician ─► 1. Technician Dashboard & Job Feed (Incoming requests + Active jobs)
       │                 └── 2. Technician Job Workspace (Review, Quote builder, Status updater)
       │
       └── Admin ──────► 1. Service Operations Console (Pipeline oversight, reassignment, parts)
```

---

## Screen Inventory Specification

### SCREEN F-01: Farmer Home
- **Role**: Farmer
- **Purpose**: Immediate orientation; surface ongoing repair status in 1 second; provide unmistakable emergency breakdown button.
- **Entry Point**: App launch / Post-login.
- **Information Hierarchy**:
  1. *Active Repair Banner* (if a job is active: Machine name, current step, live status, direct link).
  2. *Emergency Action*: High-contrast **[+ Report Equipment Breakdown]** button.
  3. *Registered Equipment Quick Strip*: Cards of farmer's machines with quick status badge (Operational / In Repair).
  4. *Assistance / Support Bar*: Quick contact to regional service desk.
- **Primary Action**: `[Report Equipment Breakdown]`
- **Secondary Actions**: `[View My Equipment]`, `[Call Service Desk]`
- **States**:
  - *Loading*: Skeleton cards for active repair and equipment list.
  - *Empty*: No equipment registered yet → Warm onboarding prompt: "Add your tractor or equipment to enable 1-tap breakdown reporting."
  - *Active Repair State*: Dominant status banner with color-coded status badge and ETA.
  - *Idle State*: All machines operational; clean green status summary.
- **Mobile Behavior**: Sticky bottom action bar containing `[+ Report Breakdown]` on mobile viewport.

---

### SCREEN F-02: Equipment Fleet & Service History
- **Role**: Farmer
- **Purpose**: Manage machines and inspect complete chronological service logs per asset.
- **Entry Point**: Bottom nav / Home shortcut.
- **Information Hierarchy**:
  1. Equipment selector tabs or card list (e.g., *John Deere 5050D*, *Sonalika DI 60*).
  2. Selected machine header: Make, Model, Year, Registration/Serial No., Total Operating Hours.
  3. Machine Status: `Operational` (Green) or `In Repair` (Amber).
  4. Chronological Service History Feed: Past repair dates, replaced parts, servicing technician, total cost.
- **Required Fields (Add Equipment Modal)**:
  - Equipment Type (Tractor, Harvester, Power Tiller, Pump, Sprayer)
  - Brand / Manufacturer
  - Model Name / Number
  - Year of Purchase (optional)
  - Current Operating Hours (optional)
  - Photo (optional)
- **Primary Action**: `[+ Add New Machine]`
- **Secondary Actions**: `[Report Breakdown for this Machine]`, `[Download Service Record]`
- **States**:
  - *Empty*: "No equipment added yet. Add your first machine in 30 seconds."
  - *No History*: "No past repairs logged. Completed repairs automatically appear here."

---

### SCREEN F-03: Breakdown Intake & Diagnostic Assessment (Wizard)
- **Role**: Farmer
- **Purpose**: Capture issue details without friction, deliver instant assistive explanation, and pick qualified technician.
- **Entry Point**: `[Report Breakdown]` button.
- **Information Hierarchy**:
  - **Step 1 (Intake)**:
    - Machine selection dropdown/pills.
    - Common symptom chips (e.g., "Engine Stalls", "Hydraulic Failure", "Overheating", "Electrical/Battery").
    - "Describe in your own words" textarea.
    - Media upload box: "Take Photo or Video of the issue" (camera trigger).
    - `[Get Diagnostic Check]` button.
  - **Step 2 (Assessment & Match)**:
    - *Diagnostic Summary Box* (Assistive AI):
      - Headline: "Likely Cause: Fuel Injection / Filter Clog"
      - Severity: "Urgent — Avoid driving machine to prevent pump wear"
      - Potential parts involved: "Primary fuel filter element"
    - *Recommended Technicians List*:
      - Ranked by expertise in this equipment make and problem domain.
      - Displays: Name, workshop name, expertise tags ("Mahindra Diesel Specialist"), distance (km), verified badge.
- **Primary Action**: `[Request Repair from Selected Technician]`
- **Secondary Actions**: `[Change Symptoms]`, `[Pick Different Technician]`
- **States**:
  - *Analyzing (Loading)*: Clean pulse indicator: "Analyzing symptoms against mechanical database..." (under 3s).
  - *Error*: "Could not complete online assessment. Showing all verified regional technicians."

---

### SCREEN F-04: Live Repair & Quote Hub
- **Role**: Farmer
- **Purpose**: Unified single-source-of-truth for the entire active repair lifecycle.
- **Entry Point**: Active repair card on Home or push notification.
- **Information Hierarchy**:
  1. Header: Machine Name & Assigned Technician Card (with direct **[Call]** button).
  2. **Linear Status Tracker**:
     `Requested` → `Technician Assigned` → `Quote Ready` → `In Progress` → `Repaired`
  3. **Conditional Action Panel**:
     - *If `QUOTE_PENDING`*: Prominent Quote Breakdown Card:
       - Itemized parts list with unit prices.
       - Service/labour fee.
       - Total quote amount (bold).
       - Estimated completion date/time.
       - Actions: **[Approve & Start Repair]** (Primary green) | **[Discuss with Technician]** (Secondary).
     - *If `IN_PROGRESS`*: Live work status notes from technician.
     - *If `WAITING_FOR_PARTS`*: Amber warning banner: "Repair paused: Technician waiting for [Hydraulic seal kit]. Estimated delivery: Tomorrow morning."
     - *If `COMPLETED`*: Green completion card with summary of work performed and `[Confirm & Save to Service History]`.
- **Primary Action**: Dependent on state (`[Approve Quote]` or `[Confirm Completion]`).
- **Secondary Action**: `[Call Technician]`

---

### SCREEN T-01: Technician Dashboard & Job Feed
- **Role**: Technician
- **Purpose**: Instant glance at incoming repair leads and currently active work orders.
- **Entry Point**: App launch / Post-login.
- **Information Hierarchy**:
  1. *Active Repair Spotlight*: Single focused card of the job currently being worked on with quick status selector.
  2. *Incoming Repair Requests* (Urgent queue):
     - Equipment model, location/distance, primary symptom, time submitted.
     - Quick buttons: `[Review Job]` / `[Accept]`.
  3. *Weekly Completed Jobs Strip*: Brief count of machines repaired and earnings summary.
- **Primary Action**: `[Accept Job]` on incoming request card.
- **Secondary Action**: `[Update Status]` on active job card.
- **States**:
  - *Empty Incoming*: "No pending requests in your area right now. You're ready for new dispatches."
  - *Offline / Busy Toggle*: Switch to pause incoming dispatches when at capacity.

---

### SCREEN T-02: Technician Job Workspace & Quote Builder
- **Role**: Technician
- **Purpose**: Comprehensive workspace to inspect customer problem, build itemized quote, toggle repair statuses, and complete job.
- **Entry Point**: Tapping any job from Dashboard.
- **Information Hierarchy**:
  1. Customer & Equipment Profile: Farmer name, phone, equipment make/model/hours, field location.
  2. Problem Report: Farmer's description, uploaded photos (expandable full-screen), assistive assessment summary.
  3. **Workflow Action Section**:
     - *State 1 (Pending)*: `[Accept Job]` or `[Decline with Reason]`.
     - *State 2 (Accepted / Diagnosing)*: **Quote Creation Form**:
       - Dynamic row repeater for Parts (Part Name, Part Number/Spec, Quantity, Unit Price).
       - Labour charge input.
       - Estimated completion date/time picker.
       - Total auto-calculation.
       - `[Submit Quote to Farmer]` button.
     - *State 3 (In Progress)*:
       - Current status selector: `In Progress` | `Waiting for Parts` | `Work Finished`.
       - Field notes textarea ("Fitted new fuel filter, bleeding injectors").
       - `[Update Status]` button.
     - *State 4 (Completion)*:
       - Upload repair proof photo (optional).
       - Final checklist confirmation.
       - `[Mark Repair Completed & Handover]`.
- **Required Fields for Quote**: At least 1 line item or labour fee; completion date estimate.
- **Primary Action**: Context-sensitive (`[Submit Quote]` / `[Update Status]` / `[Complete Job]`).

---

### SCREEN A-01: Admin / Service Centre Operations Console
- **Role**: Admin / Service Coordinator
- **Purpose**: Real-time operational visibility into repair bottlenecks; intervene to prevent downtime.
- **Entry Point**: Web/Desktop login for service coordinators.
- **Information Hierarchy**:
  1. **Operational Pulse Metrics** (Focused on downtime reduction, not vanity stats):
     - *Open Requests* (unassigned > 20 mins highlighted in red)
     - *Active Repairs in Progress*
     - *Repairs Blocked on Parts* (Amber)
     - *Avg. Downtime to Resolution* (Hours)
  2. **Active Repair Dispatch Grid**:
     - Table columns: Job ID, Machine, Farmer, Assigned Tech, Current Status, Time in Status, Action.
     - Quick Filters: `All`, `Unassigned`, `Awaiting Quote`, `Waiting for Parts`, `Overdue`.
  3. **Intervention Drawer**:
     - Click any row to reassign technician, view quote details, or update parts logistics ETA.
- **Primary Action**: `[Reassign Technician]` on stalled requests.
- **Secondary Action**: `[Filter by Blocker]`

---

## Repair Status Model

The lifecycle model is purposefully lean, deterministic, and mapped to clear farmer/technician actions:

```
[REQUESTED] 
    │  (Technician accepts)
    ▼
[ACCEPTED]
    │  (Technician inspects & sends quote)
    ▼
[QUOTE_PENDING] 
    ├── (Farmer approves) ────────┐
    └── (Farmer requests changes) ─► [QUOTE_REVISED] ──┐
                                                       ▼
                                                [IN_PROGRESS]
                                                       │  ▲
              (Parts missing) ┌────────────────────────┘  │ (Parts arrive)
                              ▼                           │
                     [WAITING_FOR_PARTS] ─────────────────┘
                              │
                              │  (Technician finishes & tests)
                              ▼
                         [COMPLETED]
                              │
                              ▼
                     (Logged to Equipment Service History)
```

### Farmer-Facing vs Internal Status Labels

| Internal Status Key | Farmer-Facing Label | Technician-Facing Label | Admin Operational State |
|---|---|---|---|
| `REQUESTED` | Finding Your Technician | New Job Request | Unassigned / Pending Acceptance |
| `ACCEPTED` | Technician Assigned (On Route / Inspecting) | Job Accepted (Prepare Quote) | Assigned — Triage Phase |
| `QUOTE_PENDING` | Quote Ready for Your Review | Quote Sent (Awaiting Approval) | Quote Sent — Awaiting Farmer |
| `IN_PROGRESS` | Repair in Progress | Work in Progress | Active Repair Underway |
| `WAITING_FOR_PARTS` | Paused: Waiting for Spare Parts | On Hold: Waiting for Parts | **SLA Risk: Supply Chain Block** |
| `COMPLETED` | Repair Complete & Verified | Job Completed & Closed | Closed — Added to Machine History |
| `CANCELLED` | Request Cancelled | Job Cancelled | Cancelled |

---

## Wireframes

### Wireframe 1: Farmer Home (`SCREEN F-01`)
```
+-------------------------------------------------------------+
| [TB Logo] TerraByte                    [Lang: EN] [Profile] |
+-------------------------------------------------------------+
|                                                             |
| ! ACTIVE REPAIR IN PROGRESS                                 |
| +---------------------------------------------------------+ |
| | Mahindra 575 DI (Tractor)                               | |
| | Status: [ REPAIR IN PROGRESS ]                          | |
| | Technician: Ramesh Kumar (Green Earth Repairs)          | |
| | ETA: Today, ~4:30 PM                                    | |
| |                                                         | |
| | [ >>> View Live Repair Status & Quote Details ]         | |
| +---------------------------------------------------------+ |
|                                                             |
| NEED IMMEDIATE HELP?                                        |
| +---------------------------------------------------------+ |
| |                                                         | |
| |       [ + REPORT EQUIPMENT BREAKDOWN ]                  | |
| |         Get diagnosis & technician dispatched           | |
| |                                                         | |
| +---------------------------------------------------------+ |
|                                                             |
| MY REGISTERED EQUIPMENT                     [ + Add Machine]|
| +-----------------------------+ +-------------------------+ |
| | Mahindra 575 DI             | | Kubota Harvester DC-68G | |
| | 2021 | 1,420 Hours          | | 2023 | 680 Hours        | |
| | Status: In Repair (Amber)   | | Status: Ready (Green)   | |
| | [View History]              | | [View History]          | |
| +-----------------------------+ +-------------------------+ |
|                                                             |
| Need phone assistance? Call Toll-Free: 1800-TERRA-HELP      |
+-------------------------------------------------------------+
| [Home]             [My Equipment]            [Past Repairs] |
+-------------------------------------------------------------+
```

### Wireframe 2: Equipment Fleet & Service Record (`SCREEN F-02`)
```
+-------------------------------------------------------------+
| [< Back]  Equipment Fleet & Records         [+ Add Machine] |
+-------------------------------------------------------------+
| [ Mahindra 575 DI * ]  [ Kubota DC-68G ]  [ Honda Water Pump]|
+-------------------------------------------------------------+
| MACHINE DETAILS                                             |
| Make/Model: Mahindra 575 DI Bhoomiputra                     |
| Category: 45 HP Utility Tractor | Reg: MH-14-EA-9921        |
| Meter: 1,420 Operating Hours    | Health: Healthy           |
|                                                             |
| Actions: [ Report Issue on this Machine ]                   |
+-------------------------------------------------------------+
| VERIFIED SERVICE HISTORY (Belongs to Machine)               |
|                                                             |
| * 14-Aug-2026: Fuel System Overhaul                         |
|   - Replaced Fuel Injector Nozzle Set & Inline Filter       |
|   - Serviced by: Ramesh Kumar (Certified Tech)              |
|   - Cost: Rs 3,450 (Parts: Rs 2,650 | Labour: Rs 800)       |
|   - Downtime: 4.5 Hours total                               |
|   [ View Original Invoice & Notes ]                         |
|   --------------------------------------------------------  |
| * 02-May-2026: Scheduled 1,000-Hour Fluid Service           |
|   - Engine oil 15W-40, Hydraulic fluid top-up, Air filter   |
|   - Serviced by: Swaraj Krishi Kendra                       |
|   - Cost: Rs 4,200 total                                    |
|   [ View Original Invoice & Notes ]                         |
+-------------------------------------------------------------+
```

### Wireframe 3: Breakdown Intake (`SCREEN F-03 - Step 1`)
```
+-------------------------------------------------------------+
| [< Cancel]           Report Breakdown              Step 1 of 2|
+-------------------------------------------------------------+
| 1. WHICH MACHINE IS DOWN?                                   |
| [ Mahindra 575 DI (Tractor)                       v ]       |
|                                                             |
| 2. WHAT SYMPTOMS ARE YOU NOTICING?                          |
| (Tap all that apply)                                        |
| [ Engine Won't Start ]  [ Overheating / White Smoke ]       |
| [ Hydraulic Won't Lift] [ Black Smoke / Loss of Power ] *   |
| [ Strange Grinding Sound] [ Steering / Brakes Failure ]     |
|                                                             |
| 3. DESCRIBE WHAT HAPPENED                                   |
| +---------------------------------------------------------+ |
| | Tractor lost pulling power in field, heavy black smoke   | |
| | coming from exhaust, engine sputtering under load.      | |
| +---------------------------------------------------------+ |
| [ O Microphome - Speak in Hindi/Marathi/Telugu ]            |
|                                                             |
| 4. ATTACH PHOTO OR SHORT VIDEO (Optional but recommended)   |
| +---------------------------------------------------------+ |
| |  [+] [Camera] Tap to snap engine / exhaust photo        | |
| |  [IMG_001.jpg attached - Exhaust manifold]              | |
| +---------------------------------------------------------+ |
|                                                             |
| [ GET INSTANT DIAGNOSTIC CHECK & FIND TECHNICIANS >>> ]     |
+-------------------------------------------------------------+
```

### Wireframe 4: Assistive Assessment & Tech Matching (`SCREEN F-03 - Step 2`)
```
+-------------------------------------------------------------+
| [< Back]         Diagnostic Check & Technicians    Step 2 of 2|
+-------------------------------------------------------------+
| ASSISTIVE PRELIMINARY ASSESSMENT                            |
| +---------------------------------------------------------+ |
| | [!] Likely Issue: Fuel Injector Clog or Air Filter Block | |
| | Severity: Moderate to High                              | |
| | Advice: Do not run engine under heavy load to prevent   | |
| |         unburnt fuel cylinder wash.                     | |
| | Expected Common Parts: Fuel filter cartridge, Nozzles   | |
| +---------------------------------------------------------+ |
|                                                             |
| SELECT SUITABLE TECHNICIAN NEAR YOU                         |
| Filtered by: Mahindra Diesel Engine Experience              |
|                                                             |
| (o) Ramesh Kumar - Green Earth Mobile Repairs  [RECOMMENDED]|
|     Speciality: Mahindra & Swaraj Diesel Fuel Systems       |
|     Location: 7 km away (Est. Arrival: 45 mins)             |
|     Rating: 4.9/5 (48 farm repairs)                         |
|     [View Profile & Credentials]                            |
|     ------------------------------------------------------- |
| ( ) Vikas Shinde - Kisan Tractor Workshop                   |
|     Speciality: Hydraulics & Transmission                   |
|     Location: 12 km away (Est. Arrival: 1 hr 15 mins)       |
|     Rating: 4.7/5 (32 farm repairs)                         |
|                                                             |
| [ REQUEST REPAIR FROM RAMESH KUMAR ]                        |
+-------------------------------------------------------------+
```

### Wireframe 5: Transparent Quote Review & Approval (`SCREEN F-04`)
```
+-------------------------------------------------------------+
| [< Back]             Repair Order #TB-8841                  |
+-------------------------------------------------------------+
| Machine: Mahindra 575 DI | Tech: Ramesh Kumar (+91 98220...) |
| Status: [ QUOTE READY FOR REVIEW ]                          |
+-------------------------------------------------------------+
| ITEMIZED REPAIR QUOTE                                       |
| Prepared by Ramesh Kumar after initial diagnostic check:    |
|                                                             |
| PARTS REQUIRED:                                             |
| 1. Bosch Fuel Injector Nozzle (x1)              Rs  1,850   |
| 2. Secondary Fuel Filter Element (Mahindra OEM) Rs    450   |
| 3. High Pressure Copper Washer Set              Rs    120   |
| ----------------------------------------------------------- |
| Parts Subtotal:                                 Rs  2,420   |
|                                                             |
| LABOUR & SERVICING:                                         |
| On-field injector calibration & fuel bleeding   Rs    750   |
| ----------------------------------------------------------- |
| TOTAL ESTIMATED COST:                           Rs  3,170   |
|                                                             |
| Estimated Completion: Today by 5:00 PM                      |
| Guarantee: 90-day warranty on fitted Bosch nozzle           |
+-------------------------------------------------------------+
| ! No work or charges start until you approve this quote.    |
|                                                             |
| [ APPROVE & AUTHORIZE REPAIR ] (Starts work immediately)    |
|                                                             |
| [ Call Ramesh to Discuss / Modify ]   [ Decline Request ]   |
+-------------------------------------------------------------+
```

### Wireframe 6: Live Repair Tracking with Blocker (`SCREEN F-04`)
```
+-------------------------------------------------------------+
| [< Home]            Live Repair Tracking                    |
+-------------------------------------------------------------+
| Mahindra 575 DI — Job #TB-8841                              |
| Technician: Ramesh Kumar [ Call Technician: 98220-XXXXX ]   |
+-------------------------------------------------------------+
| PROGRESS:                                                   |
| [x] Request Sent                                            |
| [x] Technician Assigned                                     |
| [x] Quote Approved (Rs 3,170)                               |
| [!] Waiting for Spare Part                                  |
| [ ] Work in Progress                                        |
| [ ] Repaired & Tested                                       |
+-------------------------------------------------------------+
| CURRENT STATUS:                                             |
| [!] PAUSED: WAITING FOR COMPONENT                           |
|                                                             |
| Technician Note:                                            |
| "OEM Bosch Nozzle is being picked up from Taluka distributor.|
| Expected back on-field tomorrow at 9:30 AM."               |
|                                                             |
| Revised Completion Target: Tomorrow, 11:30 AM               |
+-------------------------------------------------------------+
| Questions or urgent scheduling conflict?                    |
| [ Contact Technician ]          [ Alert Service Centre ]    |
+-------------------------------------------------------------+
```

### Wireframe 7: Technician Dashboard (`SCREEN T-01`)
```
+-------------------------------------------------------------+
| [TB Tech] Ramesh Kumar                  [Online / Ready v]  |
+-------------------------------------------------------------+
| ACTIVE JOB IN PROGRESS                                      |
| +---------------------------------------------------------+ |
| | Mahindra 575 DI — Farmer: Balasaheb Patil (Vadgaon, 6km)| |
| | Current Stage: Waiting for Part (Bosch Nozzle)          | |
| | Target: Tomorrow 11:30 AM                               | |
| |                                                         | |
| | [ >>> Open Job Workspace / Update Status ]              | |
| +---------------------------------------------------------+ |
|                                                             |
| INCOMING REPAIR REQUESTS (1 New)                            |
| +---------------------------------------------------------+ |
| | NEW REQUEST #TB-8902                                     | |
| | Equipment: John Deere 5050D (4WD)                       | |
| | Location: Khed Shivapur (11 km away)                    | |
| | Reported: Hydraulic arms not lifting plough             | |
| | AI Note: Probable spool valve seal leak or filter clog  | |
| |                                                         | |
| | [ REVIEW DETAILS ]             [ ACCEPT DISPATCH ]      | |
| +---------------------------------------------------------+ |
|                                                             |
| TODAY'S SUMMARY                                             |
| Completed Repairs: 1 | Active: 1 | Response Time: 14 mins   |
+-------------------------------------------------------------+
```

### Wireframe 8: Technician Job Workspace & Quote Creation (`SCREEN T-02`)
```
+-------------------------------------------------------------+
| [< Back]            Job Workspace #TB-8902                  |
+-------------------------------------------------------------+
| Customer: Aniket Jadhav | Phone: 94220-XXXXX [Call]         |
| Location: Khed Shivapur, Field Plot 4                       |
| Machine: John Deere 5050D | Meter: 2,100 Hours              |
+-------------------------------------------------------------+
| REPORTED PROBLEM:                                           |
| "Hydraulic arms drop under weight of 3-bottom plough."      |
| Photos: [Photo 1: Lift Cylinder] [Photo 2: Control Valve]   |
| Assessment Hypothesis: Hydraulic cylinder seal degradation  |
+-------------------------------------------------------------+
| CREATE REPAIR QUOTE                                         |
|                                                             |
| Itemized Parts:                                             |
| Item 1: [ Hydraulic Cylinder Seal Kit   ] Qty:[1] Price:[850]
| Item 2: [ Hydraulic Filter Spin-on       ] Qty:[1] Price:[620]
| [+ Add Another Part Line]                                   |
|                                                             |
| Service & Labour Fee:                                       |
| [ Cylinder disassembly, seal seating & pressure test] [900] |
|                                                             |
| Estimated Completion Time:                                  |
| [ Today, by 6:00 PM                             v ]         |
|                                                             |
| TOTAL QUOTE TO FARMER: Rs 2,370                             |
|                                                             |
| [ SEND QUOTE TO FARMER FOR APPROVAL ]                       |
+-------------------------------------------------------------+
| CURRENT EXECUTION STATUS TOGGLE:                            |
| ( ) Diagnosing  ( ) In Progress  ( ) Waiting Part  ( ) Done |
+-------------------------------------------------------------+
```

### Wireframe 9: Admin Operations Console (`SCREEN A-01`)
```
+----------------------------------------------------------------------------------------------------+
| [TB Admin] TerraByte Regional Operations — Pune South Cluster                 [User: Admin Coordinator]|
+----------------------------------------------------------------------------------------------------+
| DOWNTIME METRICS (Live)                                                                            |
| [ 2 ] Unassigned Requests   | [ 7 ] Active Repairs   | [ 2 ] Blocked on Parts | [ 3.8 hrs ] Avg Downtime |
+----------------------------------------------------------------------------------------------------+
| ACTIVE REPAIR PIPELINE                                                    [ Filter: Blocked / At Risk v ]|
+---------+-------------------+-----------------+-------------------+-------------------+------------+
| Job ID  | Machine           | Farmer          | Technician        | Status            | Elapsed    |
+---------+-------------------+-----------------+-------------------+-------------------+------------+
| TB-8841 | Mahindra 575 DI   | Balasaheb Patil | Ramesh Kumar      | WAITING_FOR_PARTS | 3h 10m (!) |
| TB-8898 | Swaraj 744 FE     | Suresh Gaikwad  | -- UNASSIGNED --  | REQUESTED (28m)   | 0h 28m (!) |
| TB-8902 | John Deere 5050D  | Aniket Jadhav   | Vikas Shinde      | QUOTE_PENDING     | 0h 42m     |
| TB-8799 | Kubota Harvester  | Ganesh More     | Mahendra Tractors | IN_PROGRESS       | 1h 50m     |
+---------+-------------------+-----------------+-------------------+-------------------+------------+
|                                                                                                    |
| ACTION DRAWER (Selected: TB-8898 - Swaraj 744 FE)                                                 |
| Issue: Steering box oil leak. No technician accepted in 25 mins.                                   |
| Available qualified techs nearby:                                                                  |
| 1. Swapnil Auti (4.8 km) - Available now                                                           |
| [ DIRECTLY ASSIGN TO SWAPNIL AUTI ]              [ CALL FARMER TO UPDATE ]                         |
+----------------------------------------------------------------------------------------------------+
```

---

## UI/UX Principles

1. **Equipment-First Architecture**: Farmers think in terms of their machines ("My Mahindra 575 is down"), not abstract tickets or support IDs. The machine is the persistent anchor.
2. **Extreme Plain Language**:
   - Never use "Triage" on farmer screens (use "Initial Assessment" or "Problem Check").
   - Never use "SLA Breach" (use "Waiting too long").
   - Never show raw error codes or stack traces.
3. **No Hidden Costs — Zero Surprise Quotes**: Quotation approval is a hard gate. A technician cannot start billable work until the farmer taps **[Approve]**.
4. **Visibility Over Blockers (Mitigate Anxiety)**: A breakdown during harvest causes immense stress. If a repair is delayed because a part is en route, state it clearly: *Why it's delayed, which part, and when it arrives*.
5. **Thumb-Driven Mobile Layout**: Primary actions (e.g. `[Report Breakdown]`, `[Approve Quote]`, `[Call Technician]`) must live in the lower half of the screen with a minimum tap target of 48px.
6. **Assistive, Non-Robotic AI**: AI suggests hypotheses to save diagnosis time; it does not claim definitive truth without technician physical confirmation.
7. **Clean Visual Restraint**:
   - Industrial, reliable, high-contrast palette (Deep Slate `#0F172A`, Clean Off-White `#F8FAFC`, Vibrant Work Safety Amber `#F59E0B`, High-Trust Forest Green `#16A34A` for operational health, and Muted Blue `#2563EB` for actions).
   - No excessive neon gradients, no glassmorphism, no stereotypical clipart farm illustrations.

---

## Important States

| State | Visual Treatment | Farmer Context | Technician Context |
|---|---|---|---|
| **Loading** | Accessible skeleton placeholders with subtle pulse | "Loading your equipment records..." | "Fetching nearby requests..." |
| **Empty (Equipment)** | Clean prompt with tractor silhouette | "You haven't registered any equipment yet." | N/A |
| **Empty (Requests)** | Muted notification bell | "No active repairs underway." | "No pending requests in your area right now." |
| **Error (Network)** | Offline banner with cached data + direct phone dialer | "Offline mode: Call helpline directly if urgent." | "Offline: Queued updates will sync when connected." |
| **Quote Awaiting** | Amber spotlight card with animated approval pulse | "Ramesh sent your quote: Rs 3,170. Review & approve." | "Waiting for farmer to approve quote." |
| **Waiting for Part**| Amber caution banner with truck icon & ETA | "Technician waiting for parts: Bosch Nozzle (ETA: Tomorrow 9:30 AM)." | "Job marked on-hold for part delivery." |
| **Completed** | Solid green checkmark card with service summary | "Repair complete & verified. Saved to machine history."| "Job signed off. Added to earnings record." |

*All seed or mock records in previews are explicitly tagged as `DEMO DATA`.*

---

## Responsive UX Matrix

| Viewport | Farmer Interface | Technician Interface | Admin Interface |
|---|---|---|---|
| **Mobile (<640px)** | Single column, sticky bottom action bar, bottom tab navigation, 48px tap targets, 1-tap phone calls. | Single column, large swipeable cards, quick-toggle status buttons, numeric keypad inputs. | Simplified urgent exception list (view-only & emergency reassignment). |
| **Tablet (640-1024px)**| 2-column split (Equipment card on left, service history/repair on right). | 2-column split (Job list on left, quote & diagnostic workspace on right). | Responsive table with drawer overlay. |
| **Desktop (>1024px)** | Centered clean max-width layout (max-w-4xl) keeping focus linear. | 2-column workspace with persistent customer sidebar. | Full-width dense operations console with split dispatch grid and live activity timeline. |

---

## Constraints
- **Zero Production Implementation in Phase 1**: No React components, Supabase configs, or Gemini API keys.
- **Low Bandwidth Field Operation**: UX must support intermittent connectivity gracefully (optimistic UI and fallback phone numbers).
- **No Fabricated Real-World Validation**: All technician names, parts lists, and metrics are simulated `DEMO DATA` for prototyping and design validation only.

---

## Open Decisions

The following UX and workflow decisions are catalogued for alignment before Phase 2 implementation:

1. **Farmer Authentication Method**:
   - *Option A*: Phone Number + SMS OTP (Most realistic for Indian rural farmers, requires SMS gateway like Twilio/Msg91).
   - *Option B*: Magic Link / Email + Password (Easiest to develop in early MVP; allows demo farmer credentials).
   - *Current Recommendation for MVP*: Support both, prioritizing simple mockable Phone OTP or 1-click Demo Role Selector for Phase 2/3 testing.
2. **Quote Dispute / Revision Path**:
   - If a farmer rejects a quote, should they be able to type a counter-offer or simply trigger a phone call to the technician?
   - *Current Recommendation*: 1-tap **[Call Technician to Discuss]** button plus simple rejection reason selector to prevent complex multi-turn negotiation UI.
3. **Technician Self-Assignment vs Admin Dispatch**:
   - Should any qualified technician be able to claim a request ("First to accept gets it"), or should the system assign exclusively to one technician at a time with a 15-minute acceptance timer?
   - *Current Recommendation*: 15-minute exclusive acceptance window for the top-matched technician; if unaccepted, cascades to the next best match or Admin console.

---

## Completed Work
- Inspected the repository (clean state with initial `.gitignore`, `LICENSE`, `README.md`).
- Established `PROJECT_STATE.md` as the unified source of truth and Phase 1 documentation hub.
- Synthesized the end-to-end information architecture for Farmer, Technician, and Admin roles.
- Streamlined the screen inventory into 4 Farmer screens, 2 Technician workspaces, and 1 Admin console.
- Formulated the complete downtime-reduction repair status lifecycle.
- Created lightweight ASCII structural wireframes for all primary user screens.
- Defined responsive breakpoints, error/empty/loading states, and visual design principles.
- Documented open UX questions for future technical phases.

---

## Known Issues
- None (Phase 1 UX specification completed according to project constraints).

---

## Next Phase
- **Phase 2 — Project Setup, Database Schema & Supabase Configuration**:
  - Initialize Vite + React + Tailwind CSS frontend environment.
  - Setup Supabase project and define PostgreSQL relational schema (`profiles`, `equipment`, `repair_requests`, `quotes`, `service_history`).
  - Configure Supabase Storage buckets for breakdown media.
  - Implement role-based row-level security (RLS) policies.

---

## Decisions Log
- **2026-09-26**: Phase 1 initiated and completed. Locked single-file documentation rule (`PROJECT_STATE.md`). Formatted UX architecture around downtime reduction. Replaced internal term "Triage" with farmer-friendly "Initial Assessment". Combined quote and live repair tracking into a single unified Hub to prevent mobile screen fragmentation.
