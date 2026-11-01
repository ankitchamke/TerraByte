# TerraByte — Project State

## 1. Current Phase & Engineering Status

- **Status**: **COMPLETE — PHASE 10.2 DOORSTEP SERVICE INTAKE & OPERATIONAL URGENCY IMPLEMENTED AND VERIFIED**
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
- **Current Milestone**: Phase 10.2 fully complete, tested, and verified across 137 automated tests in the Phase 10 suite (46 doorstep & urgency, 35 voice transcription, 50 Chrome translation & UI, 6 cleanup verification).
- **Next Phase**: Phase 10.3 — Location-Aware Automated Technician Dispatch & Dynamic Route Optimization.

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

---

## 3. Implemented Features vs. Future Roadmap Inventory

| Capability Area              | Implemented & Production Ready (Now)                                                                                                                                                                                                                                                                                            | Deferred to Future Roadmap                                                  |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------- |
| **Authentication & Roles**   | Supabase Auth (Email/Pass), RoleGuard, Profile triggers, Unverified Tech gate                                                                                                                                                                                                                                                   | Phone OTP (SMS Gateway), Social OAuth (Google/Apple)                        |
| **Machinery Fleet**          | Tractors, harvesters, tillers, pumps; Chassis/Serial tracking, Status                                                                                                                                                                                                                                                           | CAN bus J1939 telematics dongle integration                                 |
| **Breakdown Intake**         | 5-step wizard, symptom chips, Groq Whisper voice transcription (5s min, silence detection), field photos, Doorstep vs Workshop selector, 4-tier urgency assessment, machine stoppage flag, availability slots, field landmark instructions                                                                                      | Offline BackgroundSync ServiceWorker queue                                  |
| **Diagnostic Intake**        | Rule-based symptom assessment, severity, parts categories, safety tips, MCP server                                                                                                                                                                                                                                              | Multimodal Gemini 2.5 Vision image defect classification                    |
| **Multilingual Support**     | Groq Whisper Large V3 transcription (Hindi/Marathi/English script preserved), Chrome Native Translator & Language Detector API for staff-side on-demand translation                                                                                                                                                             | Automated bidirectional voice translation during calls                      |
| **Doorstep & Logistics**     | Doorstep/Workshop intake, stoppage detection, preferred timing, field landmark notes, staff triage queue sorting (Critical Stopped > Urgency > SLA Overdue > FIFO), emergency stoppage banners, OSRM driving route estimation, Google Maps directions                                                                           | Phase 10.3 Location-aware automated dispatch & multi-job route optimization |
| **Technician Matching**      | Multi-factor scoring (brand 40, skill 30, avail 20, ETA 10)                                                                                                                                                                                                                                                                     | Real-time GPS technician live turn-by-turn map tracking                     |
| **Quotation & Pricing**      | Itemized parts, labour, taxes, versioning, Quote v1 vs v2 comparison diff, Depot catalog picker                                                                                                                                                                                                                                 | Integrated UPI / Razorpay escrow payment gateway                            |
| **Repair Operations**        | 7-step stepper, parts-on-hold delay tracking, load testing, complete & sign-off                                                                                                                                                                                                                                                 | Video inspection live stream call                                           |
| **Communications**           | Ticket-scoped chat (`repair_messages`), unread tracking, read receipts                                                                                                                                                                                                                                                          | Voice note audio messaging, WhatsApp webhook bot                            |
| **Spare Parts Coordination** | Central Nagpur depot inventory (`/admin/parts-desk`), technician pickup requisitions (`/technician/job/:id`), atomic handoff with row locking, non-negative stock constraints, stock audit ledger, atomic quote formulation with `catalog_part_id`, unavailable parts sourcing & per-item ETA coordination, parts notifications | Automated vendor PO generation, multi-depot inventory transfers             |
| **Service History**          | Permanent equipment maintenance records, downtime hours, invoices                                                                                                                                                                                                                                                               | Blockchain NFT maintenance ledger                                           |
| **Data Hygiene & Demo**      | Atomic dual-key `reset_demo_data()` RPC, real user isolation, Nagpur geography, canonical parts stock restore                                                                                                                                                                                                                   | Multi-district cluster tenancy                                              |

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
5. **Language & Translation Integrity**:
   - Voice transcription preserves spoken Hindi and Marathi Devanagari script without unsolicited machine translation.
   - Translation is strictly on-demand, staff-initiated, on-device via Chrome Native APIs, and never overwrites original farmer text in `repairs.description`.
6. **Inventory Ownership**: Stock is owned by the central Service Centre (Nagpur Central Command). Technicians request parts from this depot for assigned repairs; stock is decremented atomically upon physical handoff (`ISSUED_TO_REPAIR`).
7. **Farmer Privacy Boundary**: Farmers receive high-level repair delay and ETA updates (`WAITING_FOR_PARTS`), but internal depot stock counts, wholesale costs, supplier origins, and staff audit notes are strictly quarantined at the database RLS level.
8. **Demo Account Authorization**: Reset Demo capabilities are strictly restricted on the backend via dual-key authorization to the 3 designated evaluation personas:
   - `farmer.nagpur@terrabyte.demo` (Balasaheb Patil)
   - `tech.nagpur@terrabyte.demo` (Ramesh Kumar)
   - `admin.nagpur@terrabyte.demo` (Nagpur Service Centre)
9. **Real User Isolation**: Real user data is strictly isolated by RLS and cannot be modified or cleared by demo reset operations.
10. **Assistive AI Boundary**: Machine diagnostics use rule-based reasoning with transparent markers. AI provides decision support; farmers and technicians retain final operational authority.

---

## 5. Known Limitations & Phase 10.3 Scope

### Known Limitations in Phase 10.2

- **Manual Dispatch**: Service Centre dispatchers still manually select and assign technicians from the scored candidate list.
- **Static Distance/ETA**: Technician ETAs on the job feed currently use coarse estimates based on technician profile default travel times rather than live road routing calculations.
- **Single-Job Travel**: Technician routing does not yet calculate multi-stop circuit routes between multiple agricultural fields.

### Remaining Work for Phase 10.3 (Location-Aware Automated Dispatch)

1. **Dynamic Technician Proximity Matching**: Calculate road distance from technician's workshop/current base to farmer's field landmark/GPS coordinates using OSRM matrix routing.
2. **Automated Urgency-Weighted Dispatch**: Automatically recommend or assign the nearest qualified technician for `CRITICAL` stopped-machine requests.
3. **Multi-Job Field Route Planning**: Group nearby doorstep requests in the same taluka (e.g., Saoner or Katol clusters) into daily field visit circuits for traveling mechanics.
