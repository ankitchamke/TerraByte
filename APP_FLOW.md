# TerraByte — Application Flow (APP_FLOW)

## 1. Entry Points

- **Public Root (`/`)**: Redirects authenticated users to their role workspace (`/farmer`, `/technician`, `/admin`); unauthenticated users redirect to `/login`.
- **Authentication Entry (`/login`)**: Single unified sign-in screen offering **Email + Password** and **Google OAuth** powered by Clerk.
- **Farmer Public Signup (`/signup`)**: Public account creation that provisions a Clerk identity and automatically creates a `profiles` record with `role = 'farmer'`.
- **Technician Registration (`/register-technician`)**: Public application intake where aspiring technicians create a Clerk identity and submit workshop credentials, creating a `technician_profiles` record with status `PENDING`.
- **Strict Architecture Rule**: **No public registration exists for Service Centre / Admin**. Users can never self-select or upgrade to the Admin role. Pre-auth role selector tabs are completely removed.

---

## 2. Authentication & Role Provisioning Flow

```
Visitor lands on /login
    │
    ├── Choose Auth Method:
    │      ├── A. [Continue with Google] (Google OAuth)
    │      └── B. Email + Password
    │
    ▼
Clerk verifies identity & establishes secure session
    │
    ├── [New User: Farmer Signup]
    │      └── Automatic profile creation in Supabase:
    │             profiles.auth_user_id = clerk_user_id
    │             profiles.role = 'farmer'
    │             ──► Redirect to Farmer Workspace (/farmer)
    │
    ├── [New User: Technician Registration]
    │      └── Submits workshop name, brands, experience:
    │             profiles.role = 'technician'
    │             technician_profiles.status = 'PENDING'
    │             ──► Redirect to /technician/pending
    │             (Access to /technician Dashboard strictly BLOCKED until approved)
    │
    └── [Existing User: Sign In]
           └── Query Supabase profiles by clerk_user_id:
                  │
                  ├── role === 'farmer'     ──► Redirect to /farmer
                  ├── role === 'technician' ──► Check technician approval:
                  │       ├── status === 'APPROVED' ──► Redirect to /technician
                  │       └── status === 'PENDING'  ──► Redirect to /technician/pending
                  └── role === 'admin'      ──► Redirect to /admin
                          (Admin accounts manually provisioned by system administrator)

Logout Action:
    User taps [Log Out] in navbar ──► Clerk session revoked
    ──► Client cache purged ──► Immediate redirect to /login
```

### Authentication States & Handling
- **Google OAuth**: Fast 1-click social sign-in powered by Clerk.
- **Email + Password**: Direct credential authentication with password reset link powered by Clerk.
- **Technician Pending Gate**: A registered technician whose profile is in `PENDING` status cannot access `/technician` or view repair dispatches. They are shown a polite waiting screen: *"Your application is being verified by our regional service coordinator. You will receive an alert once authorized."*
- **Unauthorized Route Protection**: Direct access to `/farmer/*` by a technician or unauthenticated user triggers a redirect to `/login` or their authorized workspace.


---

## 3. Farmer Journey

```
Login
  ──► Farmer Home (/farmer)
        │
        ├── View Registered Equipment Fleet ──► Equipment Detail (/farmer/equipment/:id)
        │                                         └── Chronological Service History
        │
        └── Tap [+ Report Equipment Breakdown]
              │
              ▼
        Breakdown Intake Wizard (/farmer/report-breakdown)
              ├── Step 1: Select Machine + Symptoms + Photo Upload
              │     │
              │     ▼
              └── Step 2: Assistive Assessment + Matched Technicians
                    │
                    ▼
              Tap [Request Repair from Technician]
                    │
                    ▼
        Live Repair & Quote Hub (/farmer/repair/:id)
              ├── Stage 1: Requested (Waiting for technician acceptance)
              ├── Stage 2: Accepted (Technician en route / diagnosing)
              ├── Stage 3: Quote Review & Approval (Approve quote gate)
              ├── Stage 4: In Progress (Live repair tracking)
              ├── Stage 5: Waiting for Parts (Blocker banner & ETA)
              └── Stage 6: Completed (Handover verification & service history saved)
```

### Detailed Farmer Screen Specifications

#### SCREEN F-01: Farmer Home (`/farmer`)

- **Purpose**: Immediate orientation; surface ongoing repair status in 1 second; provide an unmistakable emergency breakdown action.
- **Entry Point**: App launch post-login / Bottom navigation "Home".
- **Data Displayed**: Active repair order banner (if any), emergency breakdown button, registered machinery fleet cards, 24/7 service helpline.
- **Primary Action**: `[+ Report Equipment Breakdown]`
- **Secondary Actions**: `[View All Equipment]`, `[Call Helpline]`, `[View Repair Status]`.
- **Loading State**: Skeleton cards for active repair banner and machinery grid.
- **Empty State**: When no machines exist, shows warm prompt: "Add your tractor or farm equipment to enable 1-tap breakdown reporting" with `[+ Add Machine]` button.
- **Validation Error**: N/A.
- **Network Error**: Cached fleet view with prominent offline banner: "Offline mode — call technician directly if urgent."
- **Recovery**: Automatic re-fetch on network reconnection.

#### SCREEN F-02: Equipment Fleet & Service Record (`/farmer/equipment`, `/farmer/equipment/:id`)

- **Purpose**: Manage machines and inspect complete chronological service history per asset.
- **Entry Point**: Bottom nav "Equipment" / Machine card click on Home.
- **Data Displayed**: Machine specs (Make, Model, Year, Serial Number, Operating Hours, Status), chronological service log feed (dates, replaced parts, technician, total cost, downtime saved).
- **Primary Action**: `[+ Add New Machine]` (opens modal).
- **Secondary Actions**: `[Report Breakdown for this Machine]`, `[View Service Invoice]`.
- **Required Fields for Add Machine**: Type (Tractor/Harvester/Pump/etc.), Brand, Model, Serial Number; Optional: Year, Hours, Photo.
- **Loading State**: Skeleton table/cards for machine specs and service records.
- **Empty State**: "No past repairs logged. Completed repairs automatically appear here."
- **Validation Error**: Highlight missing serial number or make/model.
- **Network Error**: "Unable to load service records. [Retry]".
- **Recovery**: Pull-to-refresh or tap retry button.

#### SCREEN F-03: Breakdown Intake & Diagnostic Assessment (`/farmer/report-breakdown`)

- **Purpose**: Capture issue details without friction, deliver instant assistive explanation, and pick a qualified technician.
- **Entry Point**: `[+ Report Breakdown]` button.
- **Two-Step Flow**:
  - **Step 1 (Intake)**:
    - Select machine from fleet dropdown.
    - Common symptom chips (e.g., "Engine Won't Start", "Hydraulic Lift Stuck", "Black Smoke / Loss of Power", "Overheating", "Strange Noise").
    - Plain-language description textarea.
    - Media upload: Snap photo or attach file of affected area.
    - Action: `[Get Diagnostic Check & Find Technicians]`.
  - **Step 2 (Assessment & Match)**:
    - Assistive AI Diagnostic Summary box: Likely affected system, urgency level, probable parts.
    - Recommended Technicians List: Filtered by brand experience (e.g. "Mahindra Diesel Specialist") and proximity. Displays distance, rating, workshop name.
- **Primary Action**: `[Request Repair from Selected Technician]`
- **Secondary Actions**: `[Change Symptoms / Back]`, `[Select Different Technician]`.
- **Loading State**: Animated pulse check: "Analyzing symptoms and matching certified technicians..." (< 3 seconds).
- **Empty State (No Techs)**: "No technicians found within 25 km. Expanding search radius or alerting Service Centre Dispatch."
- **Validation Error**: Prompts farmer if no machine or symptom was selected.
- **Network Error**: "Could not complete online assessment. Showing all regional certified technicians."
- **Recovery**: Preserves entered text and photos; farmer can re-submit without retyping.

#### SCREEN F-04: Live Repair & Quote Hub (`/farmer/repair/:id`)

- **Purpose**: Unified single source of truth for the entire active repair lifecycle.
- **Entry Point**: Active repair card on Home, push notification, or deep link.
- **Data Displayed**:
  - Header: Machine name, assigned technician name, workshop, and direct `[Call Technician]` button.
  - Linear step progress indicator: `Requested` $\rightarrow$ `Technician Assigned` $\rightarrow$ `Quote Ready` $\rightarrow$ `In Progress` $\rightarrow$ `Repaired`.
  - Contextual panels based on status:
    - _When `QUOTE_PENDING`_: Itemized quote card with parts subtotal, labour, total, estimated completion time, warranty notice, and approval actions.
    - _When `IN_PROGRESS`_: Live notes from technician on field progress.
    - _When `WAITING_FOR_PARTS`_: High-visibility amber banner stating the missing part, distributor location, and updated ETA.
    - _When `COMPLETED`_: Green completion card with summary of work performed, invoice link, and sign-off button.
- **Primary Action**:
  - In `QUOTE_PENDING`: `[Approve & Authorize Repair]`
  - In `COMPLETED`: `[Confirm & Save to Equipment History]`
- **Secondary Actions**: `[Call Technician to Discuss]`, `[Decline Quote]`.
- **Loading State**: Step skeleton with pulsing status badge.
- **Error State**: "Repair record not found. [Return to Home]".
- **Recovery**: Automatic polling/real-time subscription updates.

---

## 4. Technician Journey

```
Login
  ──► Technician Dashboard (/technician)
        │
        ├── Active Job Spotlight (Quick status toggle)
        │
        └── Incoming Job Requests (Urgent leads)
              │
              ├── Tap [Accept Dispatch] ──► Status becomes ACCEPTED
              └── Tap [Review Job]
                    │
                    ▼
        Technician Job Workspace (/technician/job/:id)
              │
              ├── 1. Review Problem: Symptoms, description, farmer photos, AI hypothesis
              ├── 2. Formulate Quote: Itemized parts + labour + completion date
              │      └── Tap [Send Quote to Farmer] (Status -> QUOTE_PENDING)
              │
              ├── 3. Execute Repair (Post-approval):
              │      ├── Work underway (Status -> IN_PROGRESS)
              │      └── Parts delayed ──► Mark [Waiting for Parts] + Note + ETA
              │             └── Status -> WAITING_FOR_PARTS
              │             └── Part arrives ──► Toggle back to IN_PROGRESS
              │
              └── 4. Complete Job:
                     conduct test run ──► Tap [Mark Repair Completed]
                     ──► Status -> COMPLETED ──► Service record compiled
```

### Detailed Technician Screen Specifications

#### SCREEN T-01: Technician Dashboard & Job Feed (`/technician`)

- **Purpose**: Instant glance at incoming repair leads and currently active work orders.
- **Entry Point**: App launch post-login.
- **Data Displayed**: Active Job Spotlight card (machine, farmer name, field distance, stage), Incoming Requests list (equipment, symptom, distance, time elapsed), daily summary stats.
- **Primary Action**: `[Accept Dispatch]` on incoming request / `[Open Job Workspace]` on active job.
- **Secondary Actions**: `[Decline with Reason]`, `[Toggle Availability: Available / Busy]`.
- **Loading State**: Skeleton cards for incoming and active orders.
- **Empty State**: "No pending requests in your area right now. You are online and ready for dispatches."
- **Network Error**: "Unable to fetch new dispatches. Check your mobile connection."

#### SCREEN T-02: Technician Job Workspace & Quote Builder (`/technician/job/:id`)

- **Purpose**: Comprehensive workspace to inspect customer problem, build itemized quote, toggle repair statuses, and complete job.
- **Entry Point**: Tapping any job card from Dashboard.
- **Data Displayed**:
  - Customer contact card: Farmer name, phone, village, field plot coordinates with 1-tap call.
  - Problem report: Reported symptoms, farmer notes, photos (tap to enlarge), AI diagnostic hypothesis.
  - Dynamic workflow action section:
    - _If `ACCEPTED`_: Quote Creation Form with dynamic rows for parts (Part Name, Spec, Quantity, Unit Price, Source) + Labour Fee + Completion Date/Time picker. Auto-calculated total.
    - _If `IN_PROGRESS`_: Execution status toggle (`In Progress`, `Waiting for Parts`, `Work Finished`), work notes input.
    - _If `WAITING_FOR_PARTS`_: Missing part name input, expected delivery date/time picker, supplier note.
    - _If `COMPLETED`_: Verification checklist, completion photo upload, maintenance advice note.
- **Primary Action**: Context-sensitive (`[Submit Quote to Farmer]` / `[Update Status]` / `[Mark Repair Completed]`).
- **Validation Error**: Highlight missing parts price or missing completion ETA.
- **Network Error**: "Status update failed. Please retry."
- **Recovery**: Form inputs preserved in local state so technicians do not lose line item entries on flaky field connections.

---

## 5. Service Centre / Admin Journey

```
Login
  ──► Operations Console (/admin)
        │
        ├── 1. Operational Downtime Metrics:
        │      Open Requests | Active Repairs | Blocked on Parts | Avg Downtime Hours
        │
        ├── 2. Active Repair Dispatch Grid:
        │      Filter by: All | Unassigned | Awaiting Quote | Blocked on Parts | Overdue
        │
        └── 3. Action / Intervention Drawer (/admin/repair/:id):
               ├── Reassign stalled request to another partner workshop
               ├── Review quote disputes or delay causes
               └── Track parts supply logistics
```

### SCREEN A-01: Admin Operations Console (`/admin`, `/admin/repair/:id`)

- **Purpose**: Real-time operational oversight across regional repairs; intervene to eliminate downtime bottlenecks.
- **Entry Point**: Web/Desktop login for service coordinators.
- **Data Displayed**:
  - Real-time downtime pulse: Unassigned requests count (highlighted in red if > 20 mins), Active repairs count, Blocked on parts count, Average resolution hours.
  - Dispatch pipeline table: Job ID, Machine, Farmer, Assigned Tech, Stage, Elapsed Time in Status, Action.
  - Intervention drawer: Direct assignment dropdown, contact farmer button, contact technician button.
- **Primary Action**: `[Reassign Technician]` on stalled jobs.
- **Secondary Action**: Filter grid by risk status (`Blocked on Parts`, `Unassigned > 20m`).
- **Loading State**: Table skeleton with metric placeholders.
- **Empty State**: "No active repairs in the regional cluster."

---

## 6. Repair State Machine

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
                         [COMPLETED] ──► (Logged to Equipment Service History)
```

### Status Labels Mapping

| Internal Status     | Farmer-Facing Label             | Technician-Facing Label        | Admin Operational State           |
| ------------------- | ------------------------------- | ------------------------------ | --------------------------------- |
| `REQUESTED`         | Finding Your Technician         | New Job Request                | Unassigned / Dispatch Queue       |
| `ACCEPTED`          | Technician Assigned (On Route)  | Job Accepted (Prepare Quote)   | Assigned — Triage Phase           |
| `QUOTE_PENDING`     | Quote Ready for Your Review     | Quote Sent (Awaiting Approval) | Quote Sent — Awaiting Farmer      |
| `QUOTE_REVISED`     | Revised Quote Ready             | Quote Revised                  | Quote Revised — Awaiting Farmer   |
| `IN_PROGRESS`       | Repair in Progress              | Work in Progress               | Active Repair Underway            |
| `WAITING_FOR_PARTS` | Paused: Waiting for Spare Parts | On Hold: Waiting for Parts     | **SLA Risk: Supply Chain Block**  |
| `COMPLETED`         | Repair Complete & Verified      | Job Completed & Closed         | Closed — Added to Machine History |
| `CANCELLED`         | Request Cancelled               | Job Cancelled                  | Cancelled                         |

---

## 7. Secondary Flows & Edge Cases

- **Logout**: Tapping user avatar $\rightarrow$ `[Log Out]` clears session and navigates to `/login`.
- **Session Expiry**: When a refresh token fails, client catches `401 Unauthorized`, prompts "Session expired", and cleanly navigates to `/login`.
- **Quote Dispute / Revision**:
  - Farmer taps `[Call Technician to Discuss]` or `[Decline Quote]`.
  - Status updates to `QUOTE_REVISED`.
  - Technician edits quote line items in Workspace and taps `[Resubmit Revised Quote]`.
- **Parts Hold Blocker**:
  - Technician marks `WAITING_FOR_PARTS` with part name and ETA.
  - Farmer screen displays prominent amber banner: _Why it's delayed, which part, and when it arrives_.
  - When part arrives, technician toggles back to `IN_PROGRESS`.
- **Cancelled Repair**:
  - Farmer can cancel only while status is `REQUESTED`.
  - Once `ACCEPTED`, cancellation requires technician or admin confirmation.

---

## 8. Responsive UX Matrix & ASCII Wireframes

### Responsive Viewport Matrix

| Viewport                | Farmer Interface                                                              | Technician Interface                                                  | Admin Interface                                                        |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Mobile (<640px)**     | Single column, sticky bottom action bar, 48px tap targets, 1-tap phone calls. | Single column, swipeable cards, quick-toggle buttons, numeric inputs. | Simplified urgent exception list (view-only & emergency reassignment). |
| **Tablet (640-1024px)** | 2-column split (Machine card on left, repair/history on right).               | 2-column split (Job feed on left, workspace on right).                | Responsive table with intervention drawer overlay.                     |
| **Desktop (>1024px)**   | Centered max-w-4xl layout keeping linear focus.                               | 2-column workspace with persistent customer sidebar.                  | Full-width dense operations console with live dispatch grid.           |

### Preserved ASCII Wireframes

#### Wireframe 1: Farmer Home (`SCREEN F-01`)

```
+-------------------------------------------------------------+
| [TB Logo] TerraByte                               [Profile] |
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
| |       [ + REPORT EQUIPMENT BREAKDOWN ]                  | |
| |         Get diagnosis & technician dispatched           | |
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
| Need phone assistance? Call Helpline: 1800-TERRA-HELP       |
+-------------------------------------------------------------+
| [Home]             [My Equipment]            [Past Repairs] |
+-------------------------------------------------------------+
```

#### Wireframe 2: Breakdown Intake Wizard (`SCREEN F-03 - Step 1 & 2`)

```
+-------------------------------------------------------------+
| [< Cancel]           Report Breakdown              Step 1 of 2|
+-------------------------------------------------------------+
| 1. WHICH MACHINE IS DOWN?                                   |
| [ Mahindra 575 DI (Tractor)                       v ]       |
|                                                             |
| 2. WHAT SYMPTOMS ARE YOU NOTICING?                          |
| [ Engine Won't Start ]  [ Overheating / White Smoke ]       |
| [ Hydraulic Won't Lift] [ Black Smoke / Loss of Power ] *   |
|                                                             |
| 3. DESCRIBE WHAT HAPPENED                                   |
| +---------------------------------------------------------+ |
| | Tractor lost pulling power in field, heavy black smoke   | |
| +---------------------------------------------------------+ |
|                                                             |
| 4. ATTACH PHOTO (Optional)                                  |
| [ [+] Tap to snap engine photo ]                            |
|                                                             |
| [ GET DIAGNOSTIC CHECK & FIND TECHNICIANS >>> ]             |
+-------------------------------------------------------------+
```

#### Wireframe 3: Transparent Quote Review (`SCREEN F-04`)

```
+-------------------------------------------------------------+
| [< Back]             Repair Order #TB-8841                  |
+-------------------------------------------------------------+
| Machine: Mahindra 575 DI | Tech: Ramesh Kumar [Call]        |
| Status: [ QUOTE READY FOR REVIEW ]                          |
+-------------------------------------------------------------+
| ITEMIZED REPAIR QUOTE                                       |
|                                                             |
| PARTS REQUIRED:                                             |
| 1. Bosch Fuel Injector Nozzle Set (x1)          Rs  2,200   |
| 2. Inline Fuel Filter Cartridge (OEM)           Rs    350   |
| ----------------------------------------------------------- |
| Parts Subtotal:                                 Rs  2,550   |
|                                                             |
| LABOUR & SERVICING:                                         |
| Injector calibration, bleeding & load testing   Rs    900   |
| ----------------------------------------------------------- |
| TOTAL ESTIMATED COST:                           Rs  3,450   |
| Estimated Completion: Tomorrow, by 11:30 AM                 |
+-------------------------------------------------------------+
| ! No work or charges start until you approve this quote.    |
|                                                             |
| [ APPROVE & AUTHORIZE REPAIR ] (Starts work immediately)    |
|                                                             |
| [ Call Technician to Discuss ]       [ Decline Quote ]      |
+-------------------------------------------------------------+
```

#### Wireframe 4: Technician Job Workspace (`SCREEN T-02`)

```
+-------------------------------------------------------------+
| [< Back]            Job Workspace #TB-8902                  |
+-------------------------------------------------------------+
| Customer: Suresh Jadhav | Phone: 94220-XXXXX [Call]         |
| Machine: John Deere 5050D | Location: Sinnar, Nashik        |
+-------------------------------------------------------------+
| REPORTED PROBLEM:                                           |
| "Hydraulic arms drop under weight of 3-bottom plough."      |
| Photos: [Photo 1: Lift Cylinder]                            |
| Assessment Hypothesis: Hydraulic cylinder seal degradation  |
+-------------------------------------------------------------+
| CREATE REPAIR QUOTE                                         |
| Item 1: [ Lift Cylinder Seal Kit     ] Qty:[1] Price:[1650] |
| Item 2: [ Hydraulic Oil 15W-30 (8L)  ] Qty:[8] Price:[ 320] |
| [+ Add Another Part Line]                                   |
| Labour Fee: [ Lift cylinder reseal & pressure test ] [1400] |
| Completion Target: [ Tomorrow by 4:00 PM v ]                |
| TOTAL QUOTE: Rs 5,610                                       |
|                                                             |
| [ SEND QUOTE TO FARMER FOR APPROVAL ]                       |
+-------------------------------------------------------------+
| EXECUTION STATUS TOGGLE:                                    |
| ( ) In Progress   (*) Waiting for Parts   ( ) Completed     |
| Blocker Note: "Waiting on cylinder seal kit from dealer."   |
+-------------------------------------------------------------+
```
