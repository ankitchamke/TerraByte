<!-- refreshed: 2026-11-04 -->
# Architecture & System Design

**Analysis Date:** 2026-11-04

## 1. High-Level System Architecture & Topology

TerraByte is architected as an integrated full-stack web application designed for high responsiveness, low-latency updates, rural network resilience, and strict data isolation:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client Tier (Browser / PWA)                            │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│    Farmer Portal     │ Technician Workbench │     Service Centre Desk       │
│  `src/routes/farmer` │`src/routes/technician`│     `src/routes/admin`        │
└──────────┬───────────┴──────────┬───────────┴───────────────┬───────────────┘
           │                      │                           │
           ▼                      ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Application Server Tier (TanStack Start / Nitro)         │
│  SSR & Routing: `src/server.ts`, `src/start.ts`, `src/routes/**`             │
│  API Endpoints: `src/routes/api/health.ts`, `src/routes/api/route-estimate.ts`│
│  AI Diagnostics: `src/routes/api/assess-visual-defect.ts`                    │
│  MCP Agent Server: `src/routes/mcp.ts` (@lovable.dev/mcp-js)                 │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Database & Backend Tier (Supabase)                      │
│  PostgreSQL 17 Engine (18 Domain Tables, RLS Policies, Triggers, RPCs)       │
│  Realtime WebSocket Broadcasting (`src/hooks/use-repair-realtime.ts`)       │
│  Storage Buckets (`repair-photos`, `equipment-photos`, `avatars`)           │
│  External APIs: OSRM Routing, Google Routes API, Gemini 3.5, Groq Whisper    │
└─────────────────────────────────────────────────────────────────────────────┘
```

```mermaid
flowchart TD
    subgraph Client_Tier ["Client Tier (Browser / PWA)"]
        F_UI["Farmer Interface (/farmer)"]
        T_UI["Technician Workbench (/technician)"]
        A_UI["Service Centre Command (/admin)"]
        Hooks["Domain Hooks (useRepairTicketRealtime, useRepairListRealtime)"]
        Store["Local Form State & TanStack Query Cache"]
    end

    subgraph App_Server_Tier ["Application Server Tier (TanStack Start / Nitro)"]
        SSR["Server-Side Rendering & Streaming"]
        Router["TanStack Router (File-Based Routes & RoleGuards)"]
        MCP["MCP Server Endpoint (/mcp via @lovable.dev/mcp-js)"]
    end

    subgraph Backend_Tier ["Supabase Managed Cloud Tier"]
        Auth["Supabase Auth (JWT, Email/Password, Recovery)"]
        Realtime["Supabase Realtime (WebSockets / postgres_changes)"]
        
        subgraph PostgreSQL_Engine ["PostgreSQL 17 Relational Engine"]
            RLS["Row Level Security (RLS Policies)"]
            Triggers["Integrity Triggers (Privilege Guard, Notifications)"]
            RPC["Secure Database RPCs (reset_demo_data, delete_user_account)"]
            Tables["Domain Tables (18 Entities)"]
        end
    end

    F_UI & T_UI & A_UI --> Router
    Router --> SSR
    F_UI & T_UI & A_UI --> Hooks
    Hooks --> Realtime
    Hooks --> Store
    Store --> Tables
    F_UI & T_UI & A_UI --> Auth
    App_Server_Tier --> MCP
    MCP --> Tables
    Tables --> RLS
    RLS --> Triggers
    Triggers --> RPC
```

### Architectural Principles:
1. **Database as the Sole Source of Truth:** Live PostgreSQL 17 in Supabase manages all canonical domain records. Client stores provide optimistic local feedback but never supplant authoritative database queries.
2. **Actor Privilege Separation at the Database:** Authorization is not solely enforced at the UI router; every PostgreSQL table is secured with Row Level Security (RLS) evaluating native `auth.uid()`.
3. **Reactive WebSocket Signaling with Authoritative Refetch:** Real-time websocket events serve as lightweight invalidation signals; clients coalesce rapid bursts via debouncing (300ms window) and execute authoritative queries to guarantee consistent state.
4. **Governed Decision Boundaries:** High-risk operations (such as cancelling in-flight repairs with dispatches underway or registering new technician workshops) mandate human-in-the-loop review by Service Centre dispatchers.
5. **Decoupled Security Profile Architecture:** Public profiles (`public.profiles`) are decoupled from `auth.users.id`. Sensitive authentication secrets are strictly isolated in `public.profile_auth_secrets` with zero administrator read permissions.

---

## 2. Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Server Entry** | Normalizes SSR errors, traps h3 error bodies, and returns styled fallback pages | `src/server.ts` |
| **Start Config** | Configures CSRF protection and Supabase auth attacher middleware | `src/start.ts` |
| **Root Router** | Instantiates TanStack Router with QueryClient, scroll restoration, and meta headers | `src/router.tsx` |
| **Auth Service** | Handles sign-in, signup, sign-out, session restoration, and password reset | `src/lib/auth.ts` |
| **Repair Request Service** | Manages intake, triage assignment, status transitions, and timeline logs | `src/lib/services/repair-requests.ts` |
| **Quote Service** | Coordinates itemized estimates, revision history, and farmer approval | `src/lib/services/quotes.ts` |
| **Parts Desk Service** | Depot inventory, technician requisitions, atomic handoff, movements, and sales | `src/lib/services/parts-desk.ts` |
| **Routing Service** | Computes driving distance and ETA via OSRM with Google Routes API fallback | `src/lib/services/routing.ts` |
| **AI Diagnostics Service** | Runs multimodal tractor defect analysis via Google Gemini 3.5 Flash-Lite | `src/lib/services/gemini-diagnostic.ts` |
| **Audio Transcription** | Transcribes breakdown voice recordings via Groq Whisper Cloud API | `src/lib/services/transcription-service.ts` |
| **Realtime Hook** | Listens to Postgres changes via WebSocket and triggers coalesced cache invalidation | `src/hooks/use-repair-realtime.ts` |
| **Parts Pickup Card** | Interactive technician requisition UI for workshop and field jobs | `src/components/parts-pickup-card.tsx` |
| **Quote Comparison** | Line-by-line visual diff comparison between quote versions | `src/components/quote-comparison.tsx` |
| **Repair Chat** | Real-time messaging between farmer, assigned technician, and service centre | `src/components/repair-chat.tsx` |
| **Error Boundary** | Graceful isolation of component runtime exceptions | `src/components/component-error-boundary.tsx` |

---

## 3. Identity, Authentication & Role Hierarchy

```mermaid
flowchart TD
    UserReg["User Signs Up / In"] --> SupaAuth["Supabase Auth (auth.users)"]
    SupaAuth --> Trigger["DB Trigger: on_auth_user_created"]
    
    Trigger --> RoleChoice{"User Role Metadata"}
    RoleChoice -- role='farmer' --> P_Farmer["Insert public.profiles<br/>role='farmer', is_verified=true"]
    RoleChoice -- role='technician' --> P_Tech["Insert public.profiles<br/>role='technician', is_verified=false"]
    P_Tech --> TechProf["Insert public.technician_profiles"]
    RoleChoice -- role='service_centre' --> Rejected["Rejected: Admin Accounts<br/>Provisioned Directly by Admins Only"]
    
    P_Farmer --> AppEntry["App Entry (/)"]
    P_Tech --> PendingGate["/technician/pending Gate"]
    
    PendingGate --> AdminReview{"Admin Approval?"}
    AdminReview -- Yes (is_verified=true) --> TechActive["/technician Active Workbench"]
    AdminReview -- No --> PendingGate
```

### Role Model:
- **`farmer`**: Owners of agricultural machinery. Granted permissions to register machines, report breakdowns, review/approve quotes, communicate on tickets, and inspect service history.
- **`technician`**: Field and workshop mechanics. Granted permissions to update workshop profiles, accept dispatched jobs, formulate itemized quotes, pause for parts, conduct load testing, and sign off repairs. Blocked from workbench until verified.
- **`admin` (`service_centre`)**: Central command operators. Granted permissions to triage and assign requests, verify technicians, approve cancellation requests, oversee district parts holds, and moderate ticket communications.

### Tamper-Proofing Triggers & RPCs:
- **`guard_profile_privileges`**: An `AFTER UPDATE` trigger on `public.profiles` that raises an exception (`42501`) if a non-admin user attempts to alter their own `role` or `is_verified` columns.
- **`trg_notify_admin_on_technician_registration`**: An `AFTER INSERT` trigger on `public.technician_profiles` that dispatches an immediate administrative notification whenever a new mechanic registers for verification.
- **`public.get_session_profile()`**: Server-side RPC resolving caller profile safely without exposing sensitive authentication tokens or clerk IDs.

---

## 4. Relational Schema & Domain Data Model

The application operates across 18 core relational tables in the `public` PostgreSQL schema:

```mermaid
erDiagram
    PROFILES ||--o{ EQUIPMENT : owns
    PROFILES ||--o{ REPAIR_REQUESTS : reports
    PROFILES ||--o| TECHNICIAN_PROFILES : defines
    PROFILES ||--o{ NOTIFICATIONS : receives
    PROFILES ||--o| PROFILE_CONTACTS : contains
    EQUIPMENT ||--o{ REPAIR_REQUESTS : undergoes
    EQUIPMENT ||--o{ SERVICE_HISTORY : logs
    REPAIR_REQUESTS ||--o{ QUOTES : contains
    REPAIR_REQUESTS ||--o{ REPAIR_MESSAGES : discusses
    REPAIR_REQUESTS ||--o{ REPAIR_NOTES : documents
    REPAIR_REQUESTS ||--o{ REPAIR_TIMELINE : audits
    REPAIR_REQUESTS ||--o| SERVICE_HISTORY : generates
    REPAIR_REQUESTS ||--o| REPAIR_DISPATCH_LOCATIONS : specifies
    REPAIR_REQUESTS ||--o{ SERVICE_CENTRE_PART_REQUESTS : requisitions
    QUOTES ||--o{ QUOTE_ITEMS : itemizes
    TECHNICIAN_PROFILES ||--o{ REPAIR_REQUESTS : services
    SERVICE_CENTRE_PARTS ||--o{ SERVICE_CENTRE_PART_REQUESTS : requested_in
    SERVICE_CENTRE_PARTS ||--o{ SERVICE_CENTRE_STOCK_AUDIT : audited_in
    SERVICE_CENTRE_PARTS ||--o{ SERVICE_CENTRE_PART_SALES : sold_in

    PROFILES {
        uuid id PK
        string full_name
        string role
        string phone
        string village
        boolean is_verified
        timestamptz created_at
    }

    PROFILE_CONTACTS {
        uuid id PK
        uuid profile_id FK
        string contact_type
        string contact_value
        boolean is_primary
    }

    PROFILE_AUTH_SECRETS {
        uuid id PK
        uuid profile_id FK
        string auth_provider
        string hashed_secret
        timestamptz updated_at
    }

    TECHNICIAN_PROFILES {
        uuid id PK
        uuid profile_id FK
        string workshop_name
        string_array brands_serviced
        string_array skills
        boolean is_available
        float rating
        int jobs_completed
    }

    EQUIPMENT {
        uuid id PK
        uuid farmer_id FK
        string type
        string make
        string model
        int year
        string serial_number
        int operating_hours
        string status
    }

    REPAIR_REQUESTS {
        uuid id PK
        string job_number
        uuid equipment_id FK
        uuid farmer_id FK
        uuid technician_id FK
        string status
        boolean is_testing
        string_array symptoms
        text description
        text_array photo_urls
        jsonb diagnostic_assessment
        text cancellation_reason
        text cancellation_note
        string cancellation_previous_status
        uuid cancellation_requested_by FK
        timestamptz cancellation_requested_at
    }

    REPAIR_DISPATCH_LOCATIONS {
        uuid id PK
        uuid repair_request_id FK
        numeric latitude
        numeric longitude
        numeric accuracy_meters
        string village
        string tahsil
        timestamptz created_at
    }

    QUOTES {
        uuid id PK
        uuid repair_request_id FK
        uuid technician_id FK
        int version
        string status
        numeric parts_total
        numeric labour_charge
        numeric tax_percent
        numeric grand_total
        text labour_description
        string estimated_completion
        text farmer_revision_request
        text technician_revision_response
    }

    QUOTE_ITEMS {
        uuid id PK
        uuid quote_id FK
        uuid catalog_part_id FK
        string part_name
        string part_specification
        int quantity
        numeric unit_price
        numeric line_total
        string supplier_source
    }

    REPAIR_MESSAGES {
        uuid id PK
        uuid repair_request_id FK
        uuid sender_id FK
        uuid recipient_id FK
        text message_text
        boolean is_read
        timestamptz created_at
    }

    SERVICE_HISTORY {
        uuid id PK
        uuid equipment_id FK
        uuid repair_request_id FK
        string invoice_number
        date service_date
        int operating_hours
        numeric total_amount
        string technician_name
        string workshop_name
        text work_performed
        int downtime_hours
    }

    SERVICE_CENTRE_PARTS {
        uuid id PK
        string part_number
        string name
        string category
        string compatible_models
        int stock_quantity
        numeric unit_price
        string location
        timestamptz updated_at
    }

    SERVICE_CENTRE_PART_REQUESTS {
        uuid id PK
        uuid repair_request_id FK
        uuid part_id FK
        uuid technician_id FK
        int quantity
        string status
        text notes
        timestamptz requested_at
        timestamptz handed_off_at
        uuid handed_off_by FK
    }

    SERVICE_CENTRE_STOCK_AUDIT {
        uuid id PK
        uuid part_id FK
        int change_quantity
        int previous_stock
        int new_stock
        string reason
        uuid changed_by FK
        uuid repair_request_id FK
        uuid part_request_id FK
        timestamptz created_at
    }

    SERVICE_CENTRE_PART_SALES {
        uuid id PK
        uuid repair_request_id FK
        uuid part_id FK
        uuid quote_item_id FK
        int quantity
        numeric unit_price
        numeric total_amount
        timestamptz sold_at
    }
```

---

## 5. Row Level Security (RLS) Policy Architecture

Every table enforces PostgreSQL Row Level Security. Security boundaries are evaluated via internal SQL helper functions:
- `public.current_profile_id()`: Returns `profiles.id` corresponding to `auth.uid()`.
- `public.current_user_role()`: Returns `profiles.role` (`farmer`, `technician`, or `admin`).

### Security Matrix by Table

| Table | Operation | Enforced Policy Rules |
| :--- | :---: | :--- |
| **`equipment`** | SELECT | Owner (`farmer_id = current_profile_id()`), assigned technician on active repair, or Service Centre Admin. |
| | INSERT | Authenticated farmer only (`farmer_id = current_profile_id()`). |
| | UPDATE | Equipment owner or Service Centre Admin. |
| | DELETE | Equipment owner ONLY if `status != 'In Repair'` (protects ongoing ticket integrity). |
| **`repair_requests`**| SELECT | Ticket farmer, assigned technician, eligible technician feed (for `REQUESTED`), or Admin. |
| | INSERT | Authenticated farmer only (`farmer_id = current_profile_id()`). |
| | UPDATE | **Split across 4 purpose-driven policies**: <br/>• Farmer: may update breakdown details; can directly cancel ONLY if unassigned; must transition active tickets via `CANCELLATION_REQUESTED`. <br/>• Technician: may accept `REQUESTED` ticket, update progression (`ACCEPTED` $\rightarrow$ `QUOTE_PENDING` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `TESTING` $\rightarrow$ `COMPLETED`), or decline. Strictly prohibited from setting `CANCELLED`. <br/>• Admin: unrestricted management, manual dispatch, and cancellation resolution. <br/>• Lock: tickets in `CANCELLATION_REQUESTED` are locked against non-admin status mutation. |
| **`repair_dispatch_locations`** | SELECT | Farmer owner, assigned technician on active ticket, or Admin. Prohibited for unassigned technicians. |
| | INSERT / UPDATE | System / Ticket farmer during breakdown report flow. |
| **`quotes`** | SELECT | Farmer owning ticket, assigned technician, or Admin. |
| | INSERT | Assigned technician or Admin. Must reference valid in-flight repair. |
| | UPDATE | Assigned technician (modifying draft or building revision) or Farmer (transitioning `status` to `APPROVED` or `REVISED`). |
| **`repair_messages`**| SELECT | Ticket participants (`sender_id = current_profile_id()` OR `recipient_id = current_profile_id()`) or Admin. |
| | INSERT | Anti-spoofing check: `sender_id = current_profile_id()` AND sender is participant on `repair_request_id`. |
| | UPDATE | Recipient ONLY: allowed exclusively to update `is_read = true` (read receipts). |
| **`service_history`** | SELECT | Equipment owner, repairing technician, or Admin. |
| | INSERT | Service Centre Admin or Technician upon repair completion sign-off. |
| | UPDATE / DELETE| **BLOCKED**: Service history records are permanent, immutable ledgers. |
| **`service_centre_parts`** | SELECT | `admin` and `technician`. Farmers are strictly denied (42501/0 rows). |
| | INSERT / UPDATE / DELETE | `admin` only. Depot stock modifications require valid reasons. |
| **`service_centre_part_requests`** | SELECT | `admin` and assigned `technician` for the associated repair request. Farmers denied. |
| | INSERT | `admin` or assigned `technician` on active in-flight repairs. |
| | UPDATE | `admin` (status progression/handoff) or assigned `technician` (cancel own `PENDING` request). |
| | DELETE | `admin` only. Automatically cascades on repair request deletion. |
| **`service_centre_stock_audit`** | SELECT | `admin` only. |
| | INSERT / UPDATE / DELETE | **BLOCKED** from direct table writes; inserted strictly via `SECURITY DEFINER` atomic functions. |
| **`service_centre_part_sales`** | SELECT | `admin` only. Farmer and technician denied. |
| **`profile_auth_secrets`** | ALL | Sealed from client queries. Accessible strictly to Auth server-role routines. |

---

## 6. State Machine & Lifecycle Invariants

The repair process follows a deterministic state machine modeled around agricultural field dynamics:

```mermaid
stateDiagram-v2
    direction TB
    
    [*] --> REQUESTED: Breakdown Reported (Unassigned)
    
    REQUESTED --> CANCELLED: Farmer Cancels (Direct - Unassigned Only)
    REQUESTED --> ACCEPTED: Technician Accepts / Admin Assigns
    
    ACCEPTED --> QUOTE_PENDING: Technician Arrives & Formulates Quote
    
    QUOTE_PENDING --> QUOTE_REVISED: Farmer Requests Revision (v1)
    QUOTE_REVISED --> QUOTE_PENDING: Technician Submits Revised Quote (v2)
    
    QUOTE_PENDING --> IN_PROGRESS: Farmer Approves Quote
    
    IN_PROGRESS --> WAITING_FOR_PARTS: Spare Part Procurement Hold
    WAITING_FOR_PARTS --> IN_PROGRESS: Part Delivered, Work Resumes
    
    IN_PROGRESS --> TESTING: Mechanical Fix Complete; Field Load Testing
    TESTING --> COMPLETED: Load Verification Passes; Sign-Off
    
    ACCEPTED --> CANCELLATION_REQUESTED: Farmer Submits Cancellation
    QUOTE_PENDING --> CANCELLATION_REQUESTED: Farmer Submits Cancellation
    QUOTE_REVISED --> CANCELLATION_REQUESTED: Farmer Submits Cancellation
    IN_PROGRESS --> CANCELLATION_REQUESTED: Farmer Submits Cancellation
    WAITING_FOR_PARTS --> CANCELLATION_REQUESTED: Farmer Submits Cancellation
    
    CANCELLATION_REQUESTED --> CANCELLED: Admin Approves Cancellation
    CANCELLATION_REQUESTED --> ACCEPTED: Admin Rejects (Reverts to Previous State)
    
    COMPLETED --> [*]: Service Record Created, Equipment Operational
```

### Invariant Rules Enforced:
1. **Quotation Before Disassembly**: No ticket may transition from `ACCEPTED` directly to `IN_PROGRESS`. It must transition to `QUOTE_PENDING` and receive explicit farmer approval.
2. **Work-Hold on Cancellation Review**: While a ticket is in `CANCELLATION_REQUESTED`, technician actions (advancing status, submitting quotes, testing) are disabled in the UI and rejected by RLS.
3. **Automatic Ledger Creation**: Transitioning to `COMPLETED` requires passing testing verification and automatically generates an immutable `service_history` record with a calculated invoice number (`INV-TB-xxxx`).
4. **Equipment Availability State**: Equipment is marked `In Repair` upon breakdown creation and restored to `Operational` ONLY when all active repairs for that equipment reach `COMPLETED` or `CANCELLED`.
5. **No False Finding-State**: The UI does not display "Finding Your Technician" until the farmer has actively dispatched the technician request.

---

## 7. Concurrency Hardening & Mutation Safety (OCC)

To prevent multi-device race conditions:
```typescript
// Example: Accept repair request concurrency guard (src/lib/services/repair-requests.ts)
const { data, error } = await supabase
  .from("repair_requests")
  .update({
    technician_id: techProfileId,
    status: "ACCEPTED",
  })
  .eq("id", repairId)
  .is("technician_id", null)       // Guarantees ticket has not been claimed
  .eq("status", "REQUESTED")       // Guarantees ticket is in REQUESTED status
  .select();

if (!data || data.length === 0) {
  throw new Error("Job has already been accepted by another technician or reassigned.");
}
```

---

## 8. Supabase Realtime Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Farmer as Farmer Browser
    participant RT as Supabase Realtime (WebSocket)
    participant DB as PostgreSQL Database
    actor Tech as Technician Workbench

    Tech->>DB: Updates repair: WAITING_FOR_PARTS -> IN_PROGRESS
    DB-->>RT: postgres_changes broadcast (repair_requests)
    RT-->>Farmer: Push event to channel ticket-realtime-(id)
    Note over Farmer: useRepairTicketRealtime catches event
    Farmer->>Farmer: 300ms Coalesce Timer (Bundles burst events)
    Farmer->>DB: Authoritative refetch: getFarmerRepairRequests()
    DB-->>Farmer: Fresh data payload
    Farmer->>Farmer: Re-render UI with active progress
```

### Key Realtime Attributes:
- **Change Signaling Only:** Real-time payloads are treated as signals, not authoritative data. The client triggers an authoritative database query, preventing out-of-order partial state bugs.
- **Debounced Coalescing (300ms Window):** Bundles rapid multi-event mutations into a single network refetch.
- **Window Focus Recovery:** Window focus listeners trigger immediate refetches when returning to backgrounded tabs.

---

## 9. Spare-Parts Inventory & Sourcing Coordination Architecture (Phase 9)

```mermaid
sequenceDiagram
    autonumber
    actor Tech as Ramesh Kumar (Technician)
    participant Workbench as Job Workbench (/technician/job/:id)
    participant PartsDB as PostgreSQL service_centre_parts
    participant ReqDB as PostgreSQL service_centre_part_requests
    participant Desk as Parts Desk (/admin/parts-desk)
    actor Admin as Nagpur Service Centre (Admin)
    participant AuditDB as PostgreSQL service_centre_stock_audit

    Note over Tech,Desk: Phase 9.1 Depot Pickup Requisition Flow
    Tech->>Workbench: Inspects parts catalog & checks depot availability
    Tech->>ReqDB: requestServiceCentrePart(repairId, partId, qty, notes)
    ReqDB-->>Desk: Real-time requisition signal
    Note over Admin,Desk: Admin verifies stock on physical shelf
    Admin->>Desk: Clicks "Confirm Handoff"
    Desk->>PartsDB: confirm_service_centre_part_handoff(requestId)
    Note over PartsDB: SELECT ... FOR UPDATE (Row Lock)
    Note over PartsDB: Verifies stock >= requested qty
    PartsDB->>PartsDB: Decrements stock (stock_quantity - qty)
    PartsDB->>ReqDB: Sets status = 'HANDED_OFF', handed_off_at = now()
    PartsDB->>AuditDB: Logs immutable audit row (previous, new, reason, user)
    Desk-->>Tech: Dispatches notification: "Parts handed off for TB-xxxx"
```

### Invariants:
1. **Stock Non-Negativity & Concurrency Protection:** `CHECK (stock_quantity >= 0)` constraint and row-level locks (`SELECT ... FOR UPDATE`) in `confirm_service_centre_part_handoff`.
2. **Strict Farmer Privacy Quarantine:** Farmers have zero access to depot inventory records, wholesale acquisition rates, or staff internal notes at the PostgreSQL RLS policy level.
3. **Repair State Machine Decoupling:** Requisitioning parts does not silently alter repair status. Technicians explicitly pause/resume repairs via `WAITING_FOR_PARTS`.

---

## 10. Assistive Diagnostic Rules & Model Context Protocol (MCP)

### Diagnostic Intake Engine (`src/lib/assessment.ts`)
Maps symptom combinations and keywords to:
- Affected subsystem (Fuel injection, Hydraulics, Cooling, Transmission, Electrical, Steering/Brakes)
- Preliminary severity rating (`Low`, `Moderate`, `Moderate to High`, `High`)
- Likely parts categories required for procurement
- Urgent field safety advice
- Explicit assistive disclaimer: *"This is an assistive preliminary assessment, not a confirmed diagnosis. The technician will inspect and confirm the cause on site."*

### Model Context Protocol (MCP) Server
Active at `/mcp` via `@lovable.dev/mcp-js`:
- `list_symptoms`: Returns the canonical enumeration of recognized equipment symptoms.
- `assess_breakdown`: Evaluates symptom combinations and returns structured preliminary diagnostics.
- `match_technicians`: Evaluates equipment brand, affected system, and technician database to return objectively ranked technician matches with scoring explanations.

---

## 11. Demo Data Isolation & Atomic Reset Architecture

1. **Canonical Persona Identification:** System checks `isDesignatedDemoAccount(email)` for the 3 retained evaluation accounts:
   - `farmer.nagpur@terrabyte.demo` (Balasaheb Patil)
   - `tech.nagpur@terrabyte.demo` (Ramesh Kumar)
   - `admin.nagpur@terrabyte.demo` (Nagpur Service Centre)
2. **Dual-Key Authorization:** The PostgreSQL RPC `public.reset_demo_data()` requires:
   - Authenticated caller belongs to the designated demo set.
   - Target record has `demo_code IS NOT NULL`.
3. **Real User Isolation:** Real user records (such as `Ankit Chamke` or judges) have `demo_code IS NULL` and are 100% immune from demo resets.

---

## 12. Rural Network Resilience & Mobile UX

- **Visual Feedback & Optimistic Cues:** Instant tactile UI response while network queries resolve.
- **Bounded Payloads:** Active-only query filtering (`{ activeOnly: true }`) eliminates completed historical records from initial page loads, reducing mobile data transfer by over 90%.
- **High-Contrast Agricultural Design:** High-contrast palette (`soil amber`, `forestgreen`, `warning crimson`), min 48px touch targets, and legible typography in direct sunlight.

---

*Architecture analysis: 2026-11-04*
