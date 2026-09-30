# TerraByte — Technical Requirements Document (TRD)

## 1. Project Overview

TerraByte is a digital agricultural equipment repair ecosystem designed to coordinate the complete journey from machinery breakdown to verified repair and back to work.

- **Core Problem**: In rural agriculture, machinery breakdown (tractors, harvesters, power tillers, pumps) causes catastrophic field downtime during critical sowing and harvest windows. The current repair process is fragmented across unvetted mechanics, lack of diagnostic clarity, hidden pricing, and zero permanent service documentation.
- **Core Outcome**: **REDUCE THE TIME BETWEEN EQUIPMENT BREAKDOWN AND GETTING BACK TO WORK.**
- **Product Positioning**: TerraByte is **not** a generic mechanic marketplace. It is an end-to-end repair operating system coordinating intake, assistive diagnostic assessment, qualified technician assignment, transparent quotation, live repair status tracking with blocker visibility, and permanent equipment service history.

---

## 2. Technical Goals

1. **Reliable Repair Coordination**: Coordinate the multi-actor repair lifecycle across Farmers, Field Technicians, and Service Centre Dispatchers with deterministic status transitions.
2. **Equipment-Bound Service History**: Permanently bind verified service records to equipment assets (by serial/chassis identifier), preserving machine resale value and providing recurring diagnostic context.
3. **Role-Based Access & Security**: Enforce least-privilege data access via PostgreSQL Row Level Security (RLS) driven by authenticated user profiles.
4. **Transparent Quotation Gate**: Require farmer quote approval as a hard prerequisite before billable repair work begins, eliminating surprise repair bills.
5. **Downtime & Blocker Visibility**: Provide immediate visibility when repairs are delayed due to spare parts procurement (`WAITING_FOR_PARTS`), mitigating farmer anxiety.
6. **Assistive AI Diagnostic Intake**: Leverage server-side generative AI to translate farmer symptom descriptions and photos into preliminary diagnostic hypotheses and required parts categories, without pretending to be an infallible mechanic.
7. **Responsive & Low-Bandwidth Resilience**: Ensure mobile-first operation suitable for low-connectivity rural environments (large touch targets, phone dialer fallbacks, clean loading states).
8. **Hackathon-Simple, Maintainable Architecture**: Standard React SPA + Supabase backend without unnecessary framework abstractions, heavy microservices, or complex state libraries.

---

## 3. Locked Technology Stack

The production technology stack is locked:

| Layer                       | Technology                | Status                | Implementation Details                                                    |
| --------------------------- | ------------------------- | --------------------- | ------------------------------------------------------------------------- |
| **Frontend Framework**      | React 19 (SPA)            | **Implemented**       | Client-side React Single Page Application                                 |
| **Build Tool & Bundler**    | Vite 8                    | **Implemented**       | Fast HMR, production bundling via Rollup/Rolldown                         |
| **Language & Typings**      | TypeScript 5              | **Implemented**       | Strict typing, database schema types in `src/types/database.ts`           |
| **Routing**                 | TanStack Router 1.x       | **Implemented**       | Type-safe client-side routing across 11 core routes                       |
| **Styling & Design System** | Tailwind CSS 4            | **Implemented**       | Utility-first CSS, custom TerraByte palette (`soil`, `primary`, `accent`) |
| **UI Components & Icons**   | Radix UI + Lucide React   | **Implemented**       | Accessible primitives, Lucide tractor brand mark                          |
| **State Management**        | React Query + local store | **Implemented**       | `tb-store.ts` in Phase 2; React Query queries/mutations in Phase 3        |
| **Backend & Database**      | Supabase (PostgreSQL 17)  | **Implemented**       | Hosted in `ap-south-1` (Mumbai), 10 tables, enums, triggers, indexes      |
| **Authentication**          | Clerk                     | **Planned (Phase 3)** | Identity provider: Email + Password and Google OAuth; session management |
| **Backend & Database**      | Supabase (PostgreSQL 17)  | **Implemented**       | Roles, business data, 10 tables, RLS policies, Storage, Edge Functions    |
| **Object Storage**          | Supabase Storage          | **Implemented**       | Buckets `equipment-media` (5 MB) and `repair-media` (10 MB) with RLS      |
| **Server-Side AI**          | Google Gemini API         | **Planned (Phase 5)** | Accessed via Supabase Edge Function to protect API keys                   |
| **Hosting & Deployment**    | Vercel                    | **Planned (Phase 6)** | Static SPA hosting with rewrite rules for client routing                  |
| **Version Control**         | GitHub                    | **Implemented**       | Git repository as single source of truth                                  |
| **Primary Dev Environment** | Google Antigravity        | **Active**            | Pair-programming agentic development environment                          |

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization Strategy (Locked)

TerraByte strictly separates **Authentication (Identity)** from **Authorization (Roles & Permissions)**:

- **Identity Provider**: **Clerk** manages user registration, identity verification, credential handling, and secure session lifecycle.
- **Login Options**: **Email + Password** and **Google OAuth**.
- **Removal of Phone Auth**: Phone number login and phone SMS OTP are completely removed (eliminating SMS gateway costs and carrier setup overhead). Email OTP is not implemented unless required by Clerk's final production configuration.
- **Separation of Concerns**:
  - **Clerk** verifies *who you are* (User ID, Email address, Google identity).
  - **TerraByte / Supabase** controls *what you can do* (Roles, Profiles, Equipment, Repairs, Quotes, and PostgreSQL RLS permissions).
- **Role Provisioning Rules**:
  1. **Farmer (Public Onboarding)**: Anyone can sign up publicly as a Farmer. Upon registration, a corresponding `profiles` record is automatically created in Supabase with `role = 'farmer'`. The user enters the Farmer Workspace immediately.
  2. **Technician (Application & Verification Gate)**: Anyone can publicly select "Register as Technician" and provide workshop/brand credentials. This creates an authenticated profile and a `technician_profiles` record with status `PENDING`. **The technician is blocked from accessing the Technician Dashboard until approved/verified by the Service Centre Administrator**. A pending approval screen is displayed instead.
  3. **Service Centre / Operations (Manual Provisioning Only)**: **No public registration exists for Service Centre / Admin accounts**. These accounts must be manually provisioned by the system administrator.
  4. **Strict Prohibition**: Users must **never** be able to select or grant themselves the Service Centre/Admin role.
  5. **No Client-Side Impersonation**: No pre-auth role selector tabs or mock persona switches.
- **Session Persistence & Protected Routes**: Clerk session cookies/tokens persist across page reloads. Unauthenticated requests to `/farmer/*`, `/technician/*`, or `/admin/*` redirect immediately to `/login`.


### 4.2 Farmer Requirements

- **F-REQ-01 (Fleet Management)**: Farmer can view all registered machinery assets, view individual equipment details (make, model, year, operating hours, status), and register new equipment.
- **F-REQ-02 (Breakdown Intake)**: Farmer can report an equipment breakdown by selecting a machine, choosing common symptoms from pre-defined chips, providing plain-language description, and uploading breakdown photos.
- **F-REQ-03 (Diagnostic Summary)**: Farmer can view an assistive diagnostic hypothesis indicating likely affected system, urgency level, and probable replacement parts.
- **F-REQ-04 (Technician Selection)**: Farmer can view matching technicians qualified for their equipment brand and problem category, sorted by expertise and distance, and dispatch a repair request.
- **F-REQ-05 (Quote Review & Approval)**: Farmer can review itemized quotes (parts breakdown, labour, estimated completion date) and explicitly approve or decline the quote. Billable work cannot begin without approval.
- **F-REQ-06 (Live Tracking)**: Farmer can monitor live repair status stages (`REQUESTED` $\rightarrow$ `ACCEPTED` $\rightarrow$ `QUOTE_PENDING` $\rightarrow$ `IN_PROGRESS` $\leftrightarrow$ `WAITING_FOR_PARTS` $\rightarrow$ `COMPLETED`).
- **F-REQ-07 (Blocker Visibility)**: When a technician marks a job as waiting for parts, the farmer sees the specific missing part and expected delivery time.
- **F-REQ-08 (Direct Contact)**: Farmer can initiate a direct 1-tap phone call to the assigned technician from the repair screen.
- **F-REQ-09 (Service History)**: Farmer can view permanent chronological service records bound to each machine, showing historical repair costs, replaced parts, and downtime hours saved.

### 4.3 Field Technician Requirements

- **T-REQ-01 (Job Feed)**: Technician can view incoming repair requests in their operational zone, displaying equipment make, model, symptoms, distance, and assistive assessment summary.
- **T-REQ-02 (Accept / Decline)**: Technician can accept an incoming request (advancing status to `ACCEPTED` and notifying farmer with ETA) or decline with a reason.
- **T-REQ-03 (Active Job Workspace)**: Technician has a dedicated workspace for the active repair order displaying customer contact, field location, and full problem description.
- **T-REQ-04 (Quote Builder)**: Technician can formulate an itemized repair quote with dynamic parts line items (part name, spec, quantity, unit price, source), labour charge, and estimated completion date.
- **T-REQ-05 (Status Management)**: Technician can toggle execution status between `IN_PROGRESS`, `WAITING_FOR_PARTS` (with required missing-part notes and ETA), and `COMPLETED`.
- **T-REQ-06 (Completion & Sign-Off)**: Technician can record repair completion details, test run confirmation, maintenance advice for the farmer, and close the job.
- **T-REQ-07 (Operational Profile)**: Technician profile maintains brand specializations, skills, workshop name, rating, and availability toggle.

### 4.4 Service Centre / Admin Requirements

- **A-REQ-01 (Operations Dispatch Board)**: Admin can view all regional repair orders categorized by status, identifying bottlenecks, unassigned requests, and stalled jobs.
- **A-REQ-02 (Unassigned Alerting)**: Requests remaining unaccepted for > 30 minutes are visually flagged in amber/red for dispatcher intervention.
- **A-REQ-03 (Manual Reassignment)**: Admin can reassign any unaccepted or delayed repair order to another qualified partner workshop.
- **A-REQ-04 (Parts Sourcing Oversight)**: Admin can monitor jobs on `WAITING_FOR_PARTS` hold and coordinate parts logistics.
- **A-REQ-05 (Fleet & Regional Analytics)**: Admin can monitor average downtime hours to resolution and technician utilization.

### 4.5 Repair Workflow & State Machine

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

- `CANCELLED` is supported from early states prior to active repair work.

### 4.6 Quotes & Transparent Pricing

- Every quote requires itemized parts rows and labour charges.
- Pricing calculation: $\text{Total} = \sum(\text{Quantity} \times \text{Unit Price}) + \text{Labour} + \text{Tax}$.
- Farmer approval is a strict gate: status cannot transition to `IN_PROGRESS` until the quote is approved.
- Revisions increment the quote `version` number and maintain previous quote records.

### 4.7 Assistive AI Diagnostics

- AI serves as an assistive intake tool, not an automated mechanic.
- Input: Equipment type, make, model, operating hours, reported symptoms, plain-language description, breakdown photo.
- Output: Structured JSON containing:
  - Likely affected system (e.g. Fuel injection, Hydraulics, Cooling, Electrical).
  - Urgency level (`Low`, `Medium`, `High`, `Critical`).
  - Preliminary mechanical hypothesis.
  - Recommended parts category.
  - Safety precautions for the farmer.
- AI output is presented clearly as an "Assistive Hypothesis" requiring technician physical verification.

---

## 5. Data Requirements

The database consists of 10 relational tables in PostgreSQL managed by Supabase:

| Table                 | Purpose                                               | Primary Key | Foreign Keys                                                                                                                      |
| --------------------- | ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`            | User accounts across Farmer, Technician, Admin        | `id` (UUID) | `auth_user_id` $\rightarrow$ `auth.users(id)`                                                                                     |
| `technician_profiles` | Technician capabilities, brands, workshop, ratings    | `id` (UUID) | `profile_id` $\rightarrow$ `profiles.id` (1:1)                                                                                    |
| `equipment`           | Farmer machinery assets with operating hours & status | `id` (UUID) | `farmer_id` $\rightarrow$ `profiles.id`                                                                                           |
| `repair_requests`     | Central breakdown lifecycle job entity                | `id` (UUID) | `equipment_id` $\rightarrow$ `equipment.id`, `farmer_id` $\rightarrow$ `profiles.id`, `technician_id` $\rightarrow$ `profiles.id` |
| `quotes`              | Itemized price quotes prepared by technicians         | `id` (UUID) | `repair_request_id` $\rightarrow$ `repair_requests.id`, `technician_id` $\rightarrow$ `profiles.id`                               |
| `quote_items`         | Spare parts & supplies line items                     | `id` (UUID) | `quote_id` $\rightarrow$ `quotes.id`                                                                                              |
| `service_history`     | Permanent service records bound to equipment assets   | `id` (UUID) | `equipment_id` $\rightarrow$ `equipment.id`, `repair_request_id` $\rightarrow$ `repair_requests.id`                               |
| `repair_timeline`     | Chronological audit trail of status transitions       | `id` (UUID) | `repair_request_id` $\rightarrow$ `repair_requests.id`, `created_by_id` $\rightarrow$ `profiles.id`                               |
| `repair_notes`        | Collaborative notes between technicians & dispatchers | `id` (UUID) | `repair_request_id` $\rightarrow$ `repair_requests.id`, `author_id` $\rightarrow$ `profiles.id`                                   |
| `notifications`       | User alerts for quote approvals, holds, completions   | `id` (UUID) | `recipient_user_id` $\rightarrow$ `profiles.id`                                                                                   |

---

## 6. Security Requirements

1. **Authentication Gate**: All application routes except `/login` require a valid Supabase Auth session.
2. **Row Level Security (RLS)**: Enforced on 100% of tables in PostgreSQL.
   - Farmers access only their own equipment, repair requests, and quotes.
   - Technicians access available incoming requests and assigned repair jobs.
   - Admins possess operational visibility across all regional records.
3. **Frontend Credential Safety**:
   - Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are included in client bundles.
   - Zero service-role keys, database passwords, or CLI access tokens in frontend code.
   - Real credentials kept exclusively in gitignored `.env.local`.
4. **Server-Side AI Security**:
   - Google Gemini API key must reside exclusively in Supabase Edge Functions environment variables.
   - The browser never calls the Gemini API directly.
5. **Storage Security**:
   - Buckets enforce file size limits (5 MB equipment, 10 MB repair media) and MIME type whitelists (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`).

---

## 7. Non-Functional Requirements

- **Responsiveness**: Fully responsive from 320px width upward with thumb-friendly 48px minimum touch targets on mobile.
- **State Handling**: Every view must handle Loading (skeletons), Empty, Validation Error, and Network Failure states.
- **Performance**: Initial bundle load under 600 KB gzip; client-side route transitions under 100ms.
- **Accessibility**: Semantic HTML, visible focus states, form labels, and color-contrast ratios meeting WCAG AA standards.
- **Maintainability**: Strict TypeScript typings, zero unused dependencies, clean separation between UI components and data stores.

---

## 8. Demo Data Requirements

- All demo data must be explicitly labeled with `DEMO DATA` markers.
- **Target Demo Geography**: Nagpur, Maharashtra (Vidarbha agrarian belt — cotton, soybean, orange farming).
- **Entities**:
  - 3 Demo Farmers (Nagpur district villages: Kalmeshwar, Katol, Saoner).
  - 5 Demo Technicians with realistic workshops and brand specializations (Mahindra, John Deere, Swaraj, Kubota).
  - 1 Demo Service Centre (Nagpur Central Command).
  - 5 Equipment Assets (popular tractors, harvester, pump).
  - 3 Active Repairs across distinct lifecycle states (`WAITING_FOR_PARTS`, `QUOTE_PENDING`, `REQUESTED`).
  - Historical service logs with realistic part numbers, labour fees, and downtime hours saved.
- **No Fabricated Claims**: Never claim unverified real-world customer traction, live dealer partnerships, or certified field validation.

---

## 9. Constraints

1. **Software-First Solution**: No custom hardware or IoT telematics devices required for MVP operation.
2. **Preserve Existing UI**: Visual language, color palette, and component design established in Phase 1/1.5 must be preserved.
3. **Phase Boundary Discipline**: Build one phase at a time; never start future phases automatically.
4. **Repository as Source of Truth**: All specifications, code, and migrations reside in this single repository.

---

## 10. Definition of Done (Project V1)

1. Direct Supabase authentication works end-to-end for Farmer, Technician, and Admin accounts.
2. Full repair coordination journey operates seamlessly from breakdown intake to completion and service history logging.
3. Transparent quotation gate strictly prevents work from starting without farmer approval.
4. Parts hold blocker visibility updates in real time.
5. PostgreSQL RLS enforces role isolation with zero unauthorized access.
6. Server-side Gemini Edge Function returns structured assistive diagnostic assessments.
7. Mobile and desktop layouts tested without horizontal scroll or broken touch targets.
8. Zero credentials or secret keys exposed in Git or client bundles.
9. Production build succeeds with 0 TypeScript and 0 lint errors.
