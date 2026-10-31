# TerraByte — Project State

## 1. Current Phase & Engineering Status

- **Status**: **IN PROGRESS — PHASE 9.1 SERVICE CENTRE PARTS PICKUP IMPLEMENTED**
- **Branch**: `phase-9` (Connected to Lovable; no destructive Git history operations)
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
  - **Phase 9.1 — Service Centre Parts Pickup**: **COMPLETE** (Depot inventory, technician pickup requisitions, atomic handoff, stock audit ledger)
  - **Phase 9.2 — Stock Movement, Sales History & Quote Integration**: **COMPLETE** (Stock movement ledger, durable sales against approved quotes, returns, receiving, sales reporting, and atomic quote formulation with `catalog_part_id`)
  - **Phase 9.3 — Unavailable Parts Sourcing & ETA Coordination**: **PROPOSED / SCOPED** (Coordinating parts unavailable at depot, granular per-item sourcing ETAs on requisitions, critical-path sync to `parts_hold`)
  - **Phase 9.4 — Dedicated Parts Notifications**: **RESERVED / FUTURE** (Dedicated parts-specific notification queues, technician arrival alerts, and farmer delay updates reserved for the end of Phase 9)
- **Current Milestone**: Phase 9.2 stabilized, tested, and verified; Phase 9.3 (Unavailable Parts Sourcing) scoped as next proposal.

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
  - Gated Shell `RotateCcw` reset button for the 5 designated demo accounts.
  - Strict farmer data isolation and Nagpur taluka geography (Katol, Saoner, Umred).
  - Clean separation of completed/cancelled repairs from active triage; "Action needed" reserved strictly for actionable tickets (`QUOTE_PENDING`, `QUOTE_REVISED`, unassigned `REQUESTED`).
  - In-flight auth promise deduplication and database-level active-only query filtering (`{ activeOnly: true }`).
- **Phase 5.3 (Notification Polish)**: Aligned lifecycle copy (*"Revised Quote Ready"*, unified completion messaging), fixed demo notification fixtures, user-switch notification state clearing, safe query bounds (`limit: 25`), idempotent trigger alerts for registrations/approvals, and redesigned category pill badging.
- **Phase 5.4 (Cancellation Approval Workflow)**: Added `CANCELLATION_REQUESTED` enum and tracking columns; hardened RLS policies allowing direct farmer cancellation ONLY for unassigned requests; structured governed review for assigned/in-progress tickets; Admin Cancellation Review Card; and technician work-hold banners.
- **Phase 5.5 (Communication & Quote Revision)**:
  - `public.repair_messages` table with anti-spoofing RLS, unread tracking, and real-time chat (`<RepairChat />`).
  - Quote revision lifecycle preserving farmer clarification notes while diffing line-by-line item changes (`<QuoteComparison />`).
  - Canonical `TB-4489` Quote v1 fixture restoration.
- **Phase 5.6 (Handover & Completion Polish)**:
  - Canonical completion lifecycle verified: `IN_PROGRESS` $\rightarrow$ `TESTING` $\rightarrow$ `COMPLETED` $\rightarrow$ permanent `service_history`.
  - Admin completion notifications dispatched upon sign-off.
  - Dedicated "Completed" and "Cancelled" dashboard tabs isolating closed records from active operational triage.
  - Technician CTA aligned to *"Complete & sign off"*, eliminating ambiguous "handover confirmation" states.

### Phase 6 — Production Readiness & Account Hardening
- **Component Error Boundaries**: Implemented `<ComponentErrorBoundary />` (`src/components/component-error-boundary.tsx`) isolating runtime widget rendering failures.
- **Robust Profile Management**: Refactored `src/routes/profile.tsx` with resilient error recovery and brand specialization management.
- **Password Reset Flow**: Hardened password recovery (`/forgot-password`, `/auth/reset-password`) with secure token parsing and user feedback.
- **Media Lightbox Experience**: Integrated accessible image lightbox modal (`image-lightbox.tsx`) for breakdown photos and quote diagrams.
- **SEO & Social Metadata**: Centralized dynamic OpenGraph and document metadata configuration (`src/lib/seo.ts`).

### Phase 7 — Realtime Synchronization Foundation & Concurrency Hardening
- **Realtime Publication Registration**: Forward migration `20261006100000_phase7_1_realtime_publication_foundation.sql` idempotently registering `notifications`, `repair_requests`, `quotes`, and `repair_timeline` in the `supabase_realtime` publication.
- **Debounced Coalescing Realtime Hooks**:
  - `useRepairTicketRealtime`: Ticket-scoped hook listening to `postgres_changes` across `repair_requests`, `quotes`, and `repair_timeline` using a 300ms coalescing window. Treats events as signals only and delegates to authoritative refetches.
  - `useRepairListRealtime`: Queue-scoped hook synchronizing dashboard boards for farmers, technicians, and administrators.
- **Optimistic Concurrency Control (OCC)**: Hardened service layer mutations in `repair-requests.ts` and `quotes.ts` with precondition row checks (e.g., verifying `technician_id IS NULL` before job acceptance) to prevent multi-device race conditions.
- **Technician Decline RLS**: Forward migration `20261006110000_phase7_3_technician_decline_rls.sql` permitting assigned technicians to decline an assigned request back to `REQUESTED` while appending their ID to `declined_by`.

### Phase 8 — Stabilization and Deployment Operations
- **Health Endpoint Security Hardening (Phase 8A)**:
  - Reused generated helper `authenticateCronRequest` (`src/integrations/supabase/cron-auth.ts`) to enforce timing-safe Bearer secret authentication before any client creation or database query; accepts `CRON_SECRET` or `TERRABYTE_CRON_SECRET`.
  - Probes database strictly via verified public keys (`sb_publishable_...` or legacy anon JWT). Never reads or logs service-role credentials.
  - `HEAD /api/health` returns HTTP 200 lightweight liveness indicator without querying Supabase or requiring bearer auth.
  - Retained Vercel Cron (`vercel.json`) at `0 5 * * 1,3,5` as the sole scheduled health check.

### Phase 8B — Doorstep & Mobile Repair (Phase 8B.1 & Demo Cleanup Complete)
- **Phase 8B.1 — Service Location Intake, Optional GPS & Technician Directions**:
  - Implemented coarse location intake on `/farmer/report-breakdown`: farmer enters village name and selects from official 14 Nagpur District Tahsils (`src/lib/location.ts`).
  - Optional one-time browser GPS capture (`navigator.geolocation.getCurrentPosition`) with accuracy tracking and in-memory isolation.
  - Migration `20261027100000_phase8b_1_dispatch_locations.sql` creates table `public.repair_dispatch_locations` with strict RLS (farmer, assigned technician, admin only).
  - Directions to service location via Google Maps universal navigation link with fallback area search when GPS is absent.
  - Differentiated 3-state GPS visibility UI: (a) tickets created without GPS, (b) tickets with exact GPS captured and viewer authorized, (c) private coordinates restricted to assigned technician/farmer/admin.
  - Server-mediated in-app driving distance & ETA estimation via free public OSRM service (`router.project-osrm.org`).
  - Resilient ticket ID resolution: `getRepairDispatchLocation` and `/api/route-estimate` handle both UUIDs and human-readable job numbers.
  - Rendered on Farmer repair detail (`/farmer/repair/$id`), Technician job detail (`/technician/job/$id`), and Admin repair detail (`/admin/repair/$id`).

### Phase 9.1 — Service Centre Parts Pickup
- **Database Architecture & RLS**:
  - Forward migration `20261029100000_phase9_1_parts_pickup.sql` adding `service_centre_parts`, `service_centre_part_requests`, and `service_centre_stock_audit`.
  - Non-negative stock and positive quantity database `CHECK` constraints.
  - Strict RLS denying farmer access to inventory and request data; technicians restricted to requesting parts solely for active assigned repairs.
- **Concurrency-Safe Atomic Handoff**:
  - PostgreSQL RPC `confirm_service_centre_part_handoff(p_request_id)` using row-level locks, verifying availability and decrementing stock atomically.
  - Immutable audit trail logged in `service_centre_stock_audit` with previous and new stock, timestamp, changed_by, and associated repair request.
- **Service Centre Parts Desk (`/admin/parts-desk`)**:
  - Admin overview with pending requisitions queue, depot catalog with real-time stock levels, manual stock adjustment dialog with reason logging, and comprehensive audit ledger.
- **Technician Pickup Requisitions (`<PartsPickupCard />`)**:
  - Integrated into `/technician/job/$id` for assigned mechanics.
  - Live stock inspection across canonical parts catalog.
  - Out-of-stock guidance directly leveraging existing `WAITING_FOR_PARTS` workflow with ETA entry.
- **Dual-Mode Demo Store Fallback**:
  - Resilient dual-mode service layer in `src/lib/services/parts-desk.ts` querying Supabase first and cleanly delegating to `tb-store.ts` demo store if unmigrated or empty.
  - 5 canonical parts with complete metadata: part numbers (`0433171`, `005556958R1`, `AL120788`, `HY-GARD-15W30`, `26243171`), verified compatibility, on-hand counts (3, 8, 2, 5, 1), and shelf locations.

### Phase 9.2 — Stock Movement and Repair Sales History
- **Movement Ledger & Sales Architecture**:
  - Migration `20261029120000_phase9_2_stock_movement_sales.sql` extending stock audit with movement types (`RECEIVED`, `ISSUED_TO_REPAIR`, `RETURNED`, `ADJUSTMENT`), pricing, and quote item associations.
  - Durable `service_centre_part_sales` recording commercial sales with snapshot pricing.
- **Physical Handoff vs Commercial Sale Semantics**:
  - Handoff is an issue to repair (`ISSUED_TO_REPAIR`), decrementing stock exactly once.
  - Sales are counted strictly when parts are issued against approved quotes and capped at approved quote line quantities.
  - Returns increment on-hand stock and log immutable `RETURNED` movement, adjusting net sales reporting without deleting history.
- **Parts Desk UI**:
  - 4 tabs: Technician Requests, Depot Inventory, Stock Movements, Repair Sales & History.
  - Displays linked Phase 8 repair/service location on technician requisition cards and sales history rows.
  - Metric labeled as "Fulfilled Quote Value (Sales)" with clear disclaimer regarding unintegrated payment processing.

---

## 3. Implemented Features vs. Future Roadmap Inventory

| Capability Area | Implemented & Production Ready (Now) | Deferred to Future Roadmap |
| :--- | :--- | :--- |
| **Authentication & Roles** | Supabase Auth (Email/Pass), RoleGuard, Profile triggers, Unverified Tech gate | Phone OTP (SMS Gateway), Social OAuth (Google/Apple) |
| **Machinery Fleet** | Tractors, harvesters, tillers, pumps; Chassis/Serial tracking, Status | CAN bus J1939 telematics dongle integration |
| **Breakdown Intake** | 2-min intake form, symptom chips, Web Speech voice input, field photos | Offline BackgroundSync ServiceWorker queue |
| **Diagnostic Intake** | Rule-based symptom assessment, severity, parts categories, safety tips, MCP server | Multimodal Gemini 2.5 Vision image defect classification |
| **Technician Matching** | Multi-factor scoring (brand 40, skill 30, avail 20, ETA 10) | Real-time GPS technician live turn-by-turn map tracking |
| **Quotation & Pricing** | Itemized parts, labour, taxes, versioning, Quote v1 vs v2 comparison diff | Integrated UPI / Razorpay escrow payment gateway |
| **Repair Operations** | 7-step stepper, parts-on-hold delay tracking, load testing, complete & sign-off | Video inspection live stream call |
| **Communications** | Ticket-scoped chat (`repair_messages`), unread tracking, read receipts | Voice note audio messaging, WhatsApp webhook bot |
| **Spare Parts Coordination** | Central Nagpur depot inventory (`/admin/parts-desk`), technician pickup requisitions (`/technician/job/:id`), atomic handoff with row locking, non-negative stock constraints, stock audit ledger, atomic quote formulation with `catalog_part_id` | Unavailable-parts sourcing & multi-item ETA coordination (Phase 9.3 Proposed), dedicated parts notification subphase (Phase 9.4 Reserved), automated vendor PO generation, multi-depot inventory transfers |
| **Service History** | Permanent equipment maintenance records, downtime hours, invoices | Blockchain NFT maintenance ledger |
| **Data Hygiene & Demo** | Atomic dual-key `reset_demo_data()` RPC, real user isolation, Nagpur geography, canonical parts stock restore | Multi-district cluster tenancy |

---

## 4. Locked Engineering Decisions

1. **Regional Anchor**: Anchored strictly in **Nagpur District, Maharashtra** (Vidarbha region: Katol, Saoner, Umred talukas; cotton, soybean, orange farming contexts).
2. **Database as Source of Truth**: Live Supabase PostgreSQL is the sole source of truth. Mock store fixtures (`tb-store.ts`) serve solely as fallback reference definitions.
3. **Data Scoping Discipline**: Every data query must resolve caller identity through authenticated `auth.uid()` $\rightarrow$ `profiles` row $\rightarrow$ `profile.id`, strictly scoped to the authenticated user.
4. **Inventory Ownership**: Stock is owned by the central Service Centre (Nagpur Central Command). Technicians request parts from this depot for assigned repairs; stock is decremented atomically upon physical handoff (`ISSUED_TO_REPAIR`).
5. **Farmer Privacy Boundary**: Farmers receive high-level repair delay and ETA updates (`WAITING_FOR_PARTS`), but internal depot stock counts, wholesale costs, supplier origins, and staff audit notes are strictly quarantined at the database RLS level.
6. **Demo Account Authorization**: Reset Demo capabilities are strictly restricted on the backend via dual-key authorization to the 3 designated evaluation personas:
   - `farmer.nagpur@terrabyte.demo` (Balasaheb Patil)
   - `tech.nagpur@terrabyte.demo` (Ramesh Kumar)
   - `admin.nagpur@terrabyte.demo` (Nagpur Service Centre)
7. **Real User Isolation**: Real user data is strictly isolated by RLS and cannot be modified or cleared by demo reset operations.
8. **Assistive AI Boundary**: Machine diagnostics use rule-based reasoning with transparent markers. AI provides decision support; farmers and technicians retain final operational authority.
