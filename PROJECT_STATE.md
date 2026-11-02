# TerraByte — Project State

## 1. Current Phase & Engineering Status

- **Status**: **COMPLETE — ALL PHASES (PHASES 1 THROUGH 10.4 COMPLETE)**
- **Branch**: `phase-10` (Connected to Lovable; no destructive Git history operations)
- **Official Problem Statement**: **"One-Stop Agricultural Equipment Repair"**
- **Domain**: AgriTech · Agricultural Machinery Maintenance & Operational Coordination
- **Lifecycle Milestone Summary**:
  - **Phase 1 — Codebase Cleanup & Documentation Reset**: **COMPLETE**
  - **Phase 2 — Domain Database Foundation & Security Hardening**: **COMPLETE**
  - **Phase 3 — Core Repair & Quotation Workflows**: **COMPLETE**
  - **Phase 4 — Operational Experience & Notifications**: **COMPLETE**
  - **Phase 5 — Product Polish, Demo Reset, Communication & Completion**: **COMPLETE** (Phases 5.1 through 5.6)
  - **Phase 6 — Production Readiness & Account Hardening**: **COMPLETE** (Commit `27a1e69`)
  - **Phase 7 — Realtime Synchronization Foundation & Concurrency Hardening**: **COMPLETE** (Commit `91b7c83`)
  - **Phase 8 — Logistics, Route Estimates & Health Monitoring**: **COMPLETE** (OSRM route estimates, demo-data cleanup, commit `b4e4289`)
  - **Phase 9 — Spare Parts Coordination, Stock Movement, Sourcing & Notifications**: **COMPLETE** (Phases 9.1 through 9.4)
  - **Phase 10.1 — Multilingual Voice Transcription (Groq Whisper Large V3)**: **COMPLETE** (Serverless transcription, silence detection, 5s minimum duration, Hindi/Marathi script preservation)
  - **Phase 10.1.1 — Staff-Side On-Demand Translation (Chrome Built-in AI)**: **COMPLETE** (Chrome Native Translator & Language Detector API, 6-direction translation between English, Hindi, and Marathi, on-demand staff UI)
  - **Phase 10.2 — Doorstep Service Intake & Operational Urgency**: **COMPLETE** (Subphases 10.2-A through 10.2-D: schema migration, domain validation, wizard intake, staff triage & visibility, remote migration applied, 46 automated tests)
  - **Phase 10.3 — Location-Aware Technician Dispatch & Recommendation Engine**: **COMPLETE** (Subphases 10.3-A through 10.3-D: schema migration applied remotely, 14 Nagpur tahsil centroids, adaptive scoring matrix, workload scaling, Service Centre & Farmer UI cards, manual confirmation modal, 30 dispatch automated tests)
  - **Phase 10.4 — Multi-Job Field Route Planning & Traveling Technician Circuits**: **COMPLETE** (Subphases 10.4-A through 10.4-D: Architecture Review, Multi-Stop Circuit Engine, Technician Daily Circuit UX, Farmer Locality Hardening, Service Centre Taluka Clustering & In-Area Dispatch Integration; 65 automated Phase 10.4 tests, 248 total tests)
- **Current Milestone**: Phase 10.4 fully completed, tested, and verified across 248 automated tests in the test suite (20 taluka clustering & in-area circuit, 11 farmer locality, 25 circuit optimizer, 20 circuit UI, 10 dispatch UI, 20 dispatch engine & math, 46 doorstep urgency, 15 Chrome translator, 10 on-demand translation, 35 voice transcription, 6 cleanup verification).
- **Next Phase**: Post-Phase 10 Continuous Monitoring & Evaluation.

---

## 2. Completed Engineering Milestones

### Phase 1 through Phase 4 Baseline

- **Clean Architecture Foundation**: Built on native Supabase Auth & PostgreSQL 17 without framework sprawl.
- **PostgreSQL Relational Schema with RLS**: 11 core tables (`profiles`, `technician_profiles`, `equipment`, `repair_requests`, `quotes`, `quote_items`, `repair_messages`, `repair_notes`, `repair_timeline`, `service_history`, `notifications`) secured by least-privilege RLS policies.
- **Core State Machine**: Breakdown intake, algorithmic technician matching, itemized quotes, parts hold pauses, testing stages, and completion verification.
- **Operations & Notifications**: Role-specific notification queues, real-time toast alerts, technician verification gateway, and Service Centre command dispatch.

### Phase 5 — Product Polish & Full Lifecycle Integrity (5.1 – 5.6)

- **Phase 5.1 (Account Lifecycle)**: Contextual back navigation, profile management, password recovery tokens, branded reset templates, and atomic account deletion RPC (`public.delete_user_account()`).
- **Phase 5.2 (Demo & Data Hygiene)**:
  - Atomic `public.reset_demo_data()` PostgreSQL RPC with dual-key authorization (`email` in designated set + `demo_code IS NOT NULL`).
  - Gated Shell `RotateCcw` reset button for the designated demo accounts.
  - Strict farmer data isolation and Nagpur taluka geography (Katol, Saoner, Umred).
- **Phase 5.3 (Notification Polish)**: Aligned lifecycle copy, fixed demo notification fixtures, user-switch notification state clearing, safe query bounds (`limit: 25`), idempotent trigger alerts.
- **Phase 5.4 (Cancellation Approval Workflow)**: Added `CANCELLATION_REQUESTED` enum and tracking columns; hardened RLS policies; Admin Cancellation Review Card; technician work-hold banners.
- **Phase 5.5 (Communication & Quote Revision)**: `public.repair_messages` table with real-time chat (`<RepairChat />`); quote revision lifecycle preserving farmer clarification notes while diffing line-by-line item changes (`<QuoteComparison />`).
- **Phase 5.6 (Handover & Completion Polish)**: Canonical completion lifecycle verified: `IN_PROGRESS` $\rightarrow$ `TESTING` $\rightarrow$ `COMPLETED` $\rightarrow$ permanent `service_history`. Dedicated "Completed" and "Cancelled" dashboard tabs.

### Farmer Locality Hardening & Neutral Initialization

- **Removed Auto-Populated Defaults**: Eradicated automatic prefilling of `profile.village` (`"Katol, Nagpur"`) into the breakdown intake form (`src/routes/farmer/report-breakdown.tsx`).
- **Clean Form Initialization**: New breakdown tickets start with strictly empty village/locality and unselected tahsil dropdown (`"Select Tahsil..."`).
- **Reset State Hygiene**: "Start over" clears village to `""` rather than restoring profile village.
- **Safe Unknown Fallback**: Submission without locality submits canonical fallback `"On-site / Field"` without fabricating or assuming a tahsil.
- **Profile Location Preservation**: Enforced in `src/lib/services/profile.ts` that existing saved farmer locations are never overwritten with empty/null values.
- **Registration Form Validation**: Validates required `village` field on farmer signup (`src/routes/register/farmer.tsx`) preventing whitespace/empty submissions.
- **Localization & GPS Independence**: Full Devanagari Marathi/Hindi script preservation; GPS capture operates completely independent of manual text fields.

### Phase 6 — Production Readiness & Account Hardening

- Component error boundaries, profile management, password reset flow, media lightbox experience, dynamic SEO and OpenGraph metadata.

### Phase 7 — Realtime Synchronization Foundation & Concurrency Hardening

- Realtime publication registration (`notifications`, `repair_requests`, `quotes`, `repair_timeline`), debounced coalescing realtime hooks, optimistic concurrency control (OCC), and technician decline RLS.

### Phase 8 — Stabilization, Deployment Operations & Logistics

- Health endpoint security hardening, coarse location intake (14 Nagpur tahsils), optional browser GPS capture, dispatch location RLS table, Google Maps directions, and OSRM server-mediated driving distance/ETA estimation.

### Phase 9 — Spare Parts Coordination, Movement, Sourcing & Notifications

- Central Nagpur depot inventory (`/admin/parts-desk`), technician pickup requisitions (`/technician/job/:id`), atomic handoff with row locking, stock movement ledger, unavailable parts sourcing & per-item ETA coordination, and role-specific parts notifications.

### Phase 10.1 — Multilingual Voice Transcription (Groq Whisper Large V3)

- Server-mediated transcription endpoint (`/api/transcribe`) using Groq Whisper Large V3 with multipart streaming.
- Client audio capture with echo cancellation, noise suppression, and auto gain control.
- Silence detection and activity verification preventing misleading silent transcriptions.
- Configured 5-second minimum recording duration threshold with 60-second safety cap.
- Strict preservation of original Hindi and Marathi Devanagari script without unsolicited English translation.

### Phase 10.1.1 — Staff-Side On-Demand Translation (Chrome Built-in AI)

- Browser-native on-device translation service (`src/lib/services/chrome-translator.ts`) utilizing Chrome's built-in Translator API and Language Detector API.
- Support for 6 translation directions across English, Hindi, and Marathi (`en-hi`, `hi-en`, `en-mr`, `mr-en`, `hi-mr`, `mr-hi`).
- Reusable UI component (`<OnDemandTranslation />`) integrated into Technician Job Details and Service Centre Repair Details.
- Farmer's original description in `repairs.description` remains permanently untouched.

### Phase 10.2 — Doorstep Service Intake & Operational Urgency

- **Subphase 10.2-A (Data Model & Foundation)**:
  - Database migration `supabase/migrations/20261102100000_phase10_2_doorstep_urgency.sql` adding:
    - `service_type` (`DOORSTEP` / `WORKSHOP`, default `DOORSTEP`) with CHECK constraint and index.
    - `urgency_level` (`CRITICAL` / `HIGH` / `STANDARD` / `FLEXIBLE`, default `STANDARD`) with CHECK constraint and index.
    - `is_machine_stopped` (`boolean`, default `false`) with index.
    - `preferred_time_slot` (`varchar(100)`, nullable).
    - `field_landmark` (`varchar(300)`, nullable).
  - TypeScript database types updated in `src/integrations/supabase/types.ts`.
  - Domain validation and sanitization service in `src/lib/services/doorstep-service.ts`.
  - Service layer integration with backward-compatible defaults in `src/lib/services/repair-requests.ts`.
- **Subphase 10.2-B (Farmer Breakdown Wizard)**:
  - Step 3: Service delivery mode selector (Doorstep vs. Workshop Drop-off), optional field landmark input with 300-char counter, machine stoppage toggle with `HALTED IN FIELD` badge, 4-tier operational urgency cards, and 4-slot farmer availability chips.
  - Step 5: Review breakdown summary card displaying all 5 doorstep fields prior to submission.
  - Draft persistence in `localStorage` upgraded with backward-compatible legacy draft recovery.
- **Subphase 10.2-C (Staff Operational Visibility & Triage)**:
  - Technician incoming feed: Triage ordering placing critical stopped machines first, Doorstep/Workshop badges, urgency pills, and card alert highlighting.
  - Technician job detail: Prominent emergency alert banner, dedicated Service Logistics & Urgency card, farmer availability window, field landmark instructions, and preserved GPS/DirectionsButton navigation.
  - Service Centre repair queue: `"Service & Urgency"` table column, 3-tier triage comparator (Urgency & Stoppage > SLA Overdue > FIFO), row alert tinting, and empty-state alignment.
  - Service Centre repair detail: Ticket header badges, emergency stoppage banner, and report logistics panel.
- **Subphase 10.2-D (Verification & Documentation)**:
  - 37 automated tests passing in `tests/doorstep-urgency.test.mjs`.
  - 149 / 149 tests passing across the active suite.
  - Zero TypeScript errors in Phase 10.2 files, clean Prettier formatting, clean Nitro Vercel production build.

### Phase 10.3 — Location-Aware Technician Dispatch & Recommendation Engine

- **Subphase 10.3-A (Architecture & Inspection)**:
  - Audited existing candidate matching, GPS location schema (`repair_dispatch_locations`), and DirectionsButton routing.
  - Architected dual-mode adaptive weighting model: Emergency field stoppage (proximity-first) vs Routine maintenance (competency-first).
- **Subphase 10.3-B (Data Model, Geographic Fallback & Recommendation Engine)**:
  - Database migration `supabase/migrations/20261103100000_phase10_3_technician_dispatch.sql` adding:
    - `workshop_latitude` (`double precision`, `[-90, 90]`).
    - `workshop_longitude` (`double precision`, `[-180, 180]`).
    - `is_doorstep_capable` (`boolean DEFAULT true`).
    - `max_travel_radius_km` (`integer DEFAULT 40`, `[5, 500]`).
    - Partial composite index on `(is_doorstep_capable, is_available) WHERE is_verified = true`.
  - Updated Supabase TypeScript types in `src/integrations/supabase/types.ts`.
  - Added 14 Nagpur District tahsil centroids (`NAGPUR_TAHSIL_CENTROIDS`), normalization helper (`normalizeNagpurTahsil`), strict centroid lookup (`getNagpurTahsilCentroid`), Haversine distance, and 1.3x rural road curvature with 35 km/h transit model in `src/lib/location.ts`.
  - Bounded OSRM timeout with automatic fallback to approximate road distance in `src/lib/services/routing.ts`.
  - Pure domain adaptive scoring matrix in `src/lib/services/technician-dispatch.ts`:
    - Critical Stopped: Proximity (40), Availability (25), Brand/Skill (25), Mobile capability (10).
    - Routine: Brand (30), Skill (25), Proximity (20), Availability (15), Delivery mode (10).
    - Workload scaling: 0 jobs = 100%, 1 job = 70%, 2+ jobs = 30%.
    - Doorstep travel radius cutoff: proximity points drop to 0 if distance exceeds `max_travel_radius_km`.
- **Subphase 10.3-C (Location-Aware Dispatch UI & Visual Triage)**:
  - Service Centre repair detail: Ranked candidate cards with `⚡ Urgent Proximity Match` / `⭐ Best Match` badges, rank pills, match score percentages, exact vs estimated distance labels (`Exact GPS`, `Tahsil Estimate`, `Approx. Fallback`), availability & workload badges, brand/skill chips, mobile field capability, and travel radius warnings.
  - Emergency field dispatch banner: Prominent alert explaining rapid response weighting when machine is completely stopped.
  - Manual assignment confirmation dialog: Mandatory explicit confirmation modal displaying candidate summary and workload warnings before invoking `assignTechnician()`. Recommendations never auto-assign.
  - Privacy-safe farmer view: Upgraded `TechCard` displaying coarse distance (`~14 km (approx) · ~24 min drive`) without exposing raw GPS coordinates, technician private coordinates, or internal match scores.
- **Subphase 10.3-D (End-to-End Verification & Documentation)**:
  - 30 automated tests passing across `tests/technician-dispatch.test.mjs` (20) and `tests/dispatch-ui.test.mjs` (10).
  - 142 / 142 tests passing across all test suites in the repository.
  - Remote Supabase migration `20261103100000_phase10_3_technician_dispatch.sql` applied and verified.
  - Verified manual human assignment authority, privacy boundaries, emergency highlighting, and zero regressions.

### Phase 10.4 — Multi-Job Field Route Planning & Traveling Technician Circuits

- **Subphase 10.4-A (Read-Only Roadmap & Architecture Review)**:
  - Conducted read-only inspection of Phase 10.3 assets, routing algorithms, and technician workflows.
  - Formulated 4-part subphase breakdown: Architecture (A), Domain Engine (B), Technician UX (C), and Service Centre Clustering (D).
- **Subphase 10.4-B (Multi-Stop Circuit Optimization Engine)**:
  - Created `src/lib/services/circuit-optimizer.ts`:
    - Pure, deterministic Traveling Technician itinerary optimizer (`optimizeCircuitStops`).
    - Emergency priority pinning: `CRITICAL` + `is_machine_stopped` repairs are strictly prioritized at head of circuit.
    - Nearest-neighbor ordering followed by 2-opt refinement to minimize cumulative road kilometers.
    - Full circuit metrics calculation (`calculateCircuitMetrics` and `calculateCircuitMetricsWithRouting`): individual legs, cumulative distance/time, and return-to-depot closure.
    - Emergency detour cost analysis (`calculateDetourCost`): evaluates marginal detour in $O(N)$ without re-routing entire circuit, respecting emergency priority partitions.
    - Geographic tahsil clustering (`clusterRepairsByTahsil`): aggregates open doorstep repairs across the 14 official Nagpur tahsils, isolates unresolvable locations to "Unknown", and excludes workshop drop-offs.
  - Verified across 25 automated tests in `tests/circuit-optimizer.test.mjs`. Zero UI disruption, zero schema modifications.
- **Subphase 10.4-C (Technician Daily Field Circuit UX)**:
  - Created `src/components/technician-circuit-card.tsx`:
    - Strict visibility gate: Renders ONLY when technician has $\ge 2$ active assigned doorstep repairs (`service_type === 'DOORSTEP'` and status in `ACCEPTED`, `QUOTE_PENDING`, `QUOTE_REVISED`, `IN_PROGRESS`, `WAITING_FOR_PARTS`).
    - Workshop drop-offs and inactive requests are strictly excluded; hidden state (`return null`) for 0 or 1 doorstep jobs.
    - Sequential topological itinerary: `Depot Origin → Stop #1 → Stop #2 → ... → Return to Depot Closure`.
    - Per-leg transit metrics (`distanceFormatted` and `durationFormatted`) and per-stop cumulative road distance.
    - Primary CTA: **"Navigate to Stop #1"** launching Google Maps Directions URL to exact coordinates (or Search query to coarse village when GPS is missing).
    - Emergency breakdown notification banner: Automatically surfaces when a `CRITICAL` + `is_machine_stopped` job is present, highlighting Stop #1 priority adjustment and marginal detour impact (`+... km detour · +... mins`), with an idempotent acknowledge/dismiss button.
    - Landmark & access instructions preserved and displayed for rural field finds.
    - Privacy: Zero raw numeric GPS coordinates rendered into plain user text.
  - Integrated into technician workbench (`src/routes/technician/index.tsx`) above `Section title="Active jobs"`.
  - Verified across 20 automated tests in `tests/circuit-ui.test.mjs` verifying navigation accuracy, exact GPS precedence, batch dispatch location resolution, zero-distance edge cases, and privacy boundaries. Production build and TypeScript compile cleanly.
- **Subphase 10.4-D (Service Centre Taluka Clustering & Dispatch Dashboard Integration)**:
  - Created `src/components/admin-taluka-clusters.tsx`:
    - Groups open, unassigned doorstep repair requests (`status === 'REQUESTED'`, `!technician_id`, `service_type === 'DOORSTEP'`) into geographic Nagpur taluka cards using `clusterRepairsByTahsil`.
    - Real-time tally of active taluka clusters, total unassigned doorstep volume, and critical stopped machines.
    - Prominent Emergency Alert banner highlighting critical field stoppages with immediate taluka attribution.
    - Visual urgency breakdown chips (`Critical`, `High`, `Standard`, `Flexible`) and direct ticket shortcut pills.
    - Interactive cluster click-to-filter syncing with operations table filter state; active selection indicator and "Show all clusters" reset button.
    - Clean empty-state reassurance when all doorstep repairs are assigned or in progress.
    - Zero exposure of raw GPS coordinates; strictly renders normalized taluka names.
  - Integrated into Service Centre Operations Board (`src/routes/admin/index.tsx`) between KPI cards and filter tabs.
  - Upgraded Technician Recommendation Engine (`src/lib/services/technicians.ts` & `src/lib/services/technician-dispatch.ts`):
    - Added In-Area Circuit detection: checks whether candidate technician already has an active doorstep job in the same normalized tahsil.
    - Piggybacks on existing technician active-job query with zero additional network requests.
    - Deterministic tie-breaker: prefers technicians already operating in the same taluka when dispatch match scores are tied, preserving all 100-point score invariants.
  - Enhanced Service Centre Repair Detail (`src/routes/admin/repair/$id.tsx`):
    - Displays prominent emerald `In-Area Circuit` badge (`Navigation` icon) and concise explanation (e.g. `"Already scheduled in Katol today"`).
    - Highlights in-area circuit context in the manual assignment confirmation modal.
  - Extended Tahsil Normalization (`src/lib/location.ts`):
    - Added Devanagari script aliases for all 14 Nagpur tahsils (e.g. काटोल, सावनेर, उमरेड, कलमेश्वर, रामटेक).
  - Verified across 20 automated tests in `tests/taluka-clustering.test.mjs`.

---

## 3. Implemented Features vs. Future Roadmap Inventory

| Capability Area              | Implemented & Production Ready (Now)                                                                                                                                                                                                                                                                                            | Deferred to Future Roadmap                                       |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------- |
| **Authentication & Roles**   | Supabase Auth (Email/Pass), RoleGuard, Profile triggers, Unverified Tech gate                                                                                                                                                                                                                                                   | Phone OTP (SMS Gateway), Social OAuth (Google/Apple)             |
| **Machinery Fleet**          | Tractors, harvesters, tillers, pumps; Chassis/Serial tracking, Status                                                                                                                                                                                                                                                           | CAN bus J1939 telematics dongle integration                      |
| **Breakdown Intake**         | 5-step wizard, symptom chips, Groq Whisper voice transcription (5s min, silence detection), field photos, Doorstep vs Workshop selector, 4-tier urgency assessment, machine stoppage flag, availability slots, field landmark instructions                                                                                      | Offline BackgroundSync ServiceWorker queue                       |
| **Diagnostic Intake**        | Rule-based symptom assessment, severity, parts categories, safety tips, MCP server                                                                                                                                                                                                                                              | Multimodal Gemini 2.5 Vision image defect classification         |
| **Multilingual Support**     | Groq Whisper Large V3 transcription (Hindi/Marathi/English script preserved), Chrome Native Translator & Language Detector API for staff-side on-demand translation, Devanagari tahsil normalization                                                                                                                           | Automated bidirectional voice translation during calls           |
| **Doorstep & Logistics**     | Doorstep/Workshop intake, stoppage detection, preferred timing, field landmark notes, staff triage queue sorting (Critical Stopped > Urgency > SLA Overdue > FIFO), emergency stoppage banners, OSRM driving route estimation, Google Maps directions, multi-stop daily field circuit optimization, Service Centre taluka clustering | Live vehicle telematics IoT sensor telemetry                     |
| **Technician Dispatch**      | Location-aware adaptive recommendation engine (Nagpur tahsil centroids, OSRM driving distance with rural road fallback, active workload scaling, emergency stoppage weighting, doorstep travel radius cutoff, in-area circuit match & tie-breaking, manual assignment confirmation modal, privacy-safe farmer view)            | Real-time GPS technician live turn-by-turn map tracking          |
| **Quotation & Pricing**      | Itemized parts, labour, taxes, versioning, Quote v1 vs v2 comparison diff, Depot catalog picker                                                                                                                                                                                                                                 | Integrated UPI / Razorpay escrow payment gateway                 |
| **Repair Operations**        | 7-step stepper, parts-on-hold delay tracking, load testing, complete & sign-off                                                                                                                                                                                                                                                 | Video inspection live stream call                                |
| **Communications**           | Ticket-scoped chat (`repair_messages`), unread tracking, read receipts                                                                                                                                                                                                                                                          | Voice note audio messaging, WhatsApp webhook bot                 |
| **Spare Parts Coordination** | Central Nagpur depot inventory (`/admin/parts-desk`), technician pickup requisitions (`/technician/job/:id`), atomic handoff with row locking, non-negative stock constraints, stock audit ledger, atomic quote formulation with `catalog_part_id`, unavailable parts sourcing & per-item ETA coordination, parts notifications | Automated vendor PO generation, multi-depot inventory transfers  |
| **Service History**          | Permanent equipment maintenance records, downtime hours, invoices                                                                                                                                                                                                                                                               | Blockchain NFT maintenance ledger                                |
| **Data Hygiene & Demo**      | Atomic dual-key `reset_demo_data()` RPC, real user isolation, Nagpur geography, canonical parts stock restore                                                                                                                                                                                                                   | Multi-district cluster tenancy                                   |

---

## 4. Locked Engineering Decisions

1. **Regional Anchor**: Anchored strictly in **Nagpur District, Maharashtra** (Vidarbha region: Katol, Saoner, Umred talukas; cotton, soybean, orange farming contexts).
2. **Database as Source of Truth**: Live Supabase PostgreSQL is the sole source of truth. Mock store fixtures (`tb-store.ts`) serve solely as fallback reference definitions.
3. **Data Scoping Discipline**: Every data query must resolve caller identity through authenticated `auth.uid()` $\rightarrow$ `profiles` row $\rightarrow$ `profile.id`, strictly scoped to the authenticated user.
4. **Doorstep Service Canon**:
   - `service_type` defaults to `DOORSTEP` (reflecting agricultural reality where disabled machines cannot easily travel).
   - `urgency_level` defaults to `STANDARD`.
   - `is_machine_stopped` defaults to `false`.
   - Field landmarks are accepted exclusively for Doorstep repairs (max 300 characters).
   - Priority queue sorting formula: `Critical + Stopped Machine (100) > Critical (80) > High (60) > Standard (40) > Flexible (20)`. Ties break via SLA overdue status, then FIFO (`status_since`).
5. **Location-Aware Dispatch Canon**:
   - Recommendations are strictly assistive decision support and **never auto-assign** in the background without explicit human confirmation.
   - Proximity is weighted highest (40%) during critical field stoppages, whereas brand specialization is weighted highest (30%) during routine repairs.
   - Unrecognized regional locations strictly return `null` and never silently default to Nagpur city.
   - Farmer exact GPS coordinates and technician private coordinates are never leaked to unassigned roles or rendered in farmer views.
6. **Circuit & Field Route Canon**:
   - Sequential Traveling Technician circuits pin `CRITICAL` + `is_machine_stopped` field breakdowns at Stop #1.
   - The circuit card renders on the technician workbench only when $\ge 2$ active doorstep repairs are assigned.
   - Service Centre taluka clustering displays open, unassigned doorstep repairs to highlight regional demand concentrations.
   - In-area circuit operates as a gentle, deterministic tie-breaker for candidate technicians already operating in that taluka, preserving 0-100 score bounds.
7. **Language & Translation Integrity**:
   - Voice transcription preserves spoken Hindi and Marathi Devanagari script without unsolicited machine translation.
   - Translation is strictly on-demand, staff-initiated, on-device via Chrome Native APIs, and never overwrites original farmer text in `repairs.description`.
8. **Inventory Ownership**: Stock is owned by the central Service Centre (Nagpur Central Command). Technicians request parts from this depot for assigned repairs; stock is decremented atomically upon physical handoff (`ISSUED_TO_REPAIR`).
9. **Farmer Privacy Boundary**: Farmers receive high-level repair delay and ETA updates (`WAITING_FOR_PARTS`), but internal depot stock counts, wholesale costs, supplier origins, and staff audit notes are strictly quarantined at the database RLS level.
10. **Demo Account Authorization**: Reset Demo capabilities are strictly restricted on the backend via dual-key authorization to the 3 designated evaluation personas:
   - `farmer.nagpur@terrabyte.demo` (Balasaheb Patil)
   - `tech.nagpur@terrabyte.demo` (Ramesh Kumar)
   - `admin.nagpur@terrabyte.demo` (Nagpur Service Centre)
11. **Real User Isolation**: Real user data is strictly isolated by RLS and cannot be modified or cleared by demo reset operations.
12. **Assistive AI Boundary**: Machine diagnostics use rule-based reasoning with transparent markers. AI provides decision support; farmers and technicians retain final operational authority.

---

## 5. Completed Phase 10 Scope & Future Horizons

### Completed in Phase 10.4
- **Multi-Job Field Route Planning**: Group nearby doorstep requests in the same taluka cluster (e.g. Katol or Saoner) into daily field visit circuits for traveling mechanics.
- **Dynamic Circuit Itinerary & Emergency Re-Ordering**: Sequential itinerary with nearest-neighbor and 2-opt refinement, emergency breakdown pinning at Stop #1, per-leg driving metrics, and marginal detour cost calculations.
- **Service Centre Taluka Breakdown Clusters**: Live dashboard widget on `/admin` grouping open, unassigned doorstep repairs by normalized Nagpur tahsil with interactive filtering and critical stoppage alerts.
- **In-Area Circuit Dispatch Bonus**: Intelligent recommendation tie-breaker prioritizing mechanics already operating within the destination taluka today.
- **Farmer Locality Neutrality**: Clean form initialization without assumed Katol defaults; Devanagari script normalization for all 14 Nagpur tahsils.
