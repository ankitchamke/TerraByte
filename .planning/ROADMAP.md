# Roadmap: TerraByte

## Overview

TerraByte coordinates the agricultural equipment repair lifecycle from breakdown intake to verified completion. Development follows a strictly disciplined phased delivery model, advancing from database and state foundation to multi-role workflows, real-time coordination, spare parts logistics, AI diagnostics, trust & accountability, and smart dispatch.

The overarching design objective is to **dramatically compress the time between machinery breakdown and getting back to work in the field** across Maharashtra's Vidarbha agrarian region, under a strict **$0.00 Free-Tier Budget Constraint** (zero paid external services, zero billing surprise risks).

---

## Master Phase Summary

- [x] **Phase 1: Codebase Cleanup & Documentation Reset** — Establish project baseline, clean structure, TanStack Start + Vite 8.
- [x] **Phase 2: Domain Database Foundation & Security Hardening** — PostgreSQL 17 relational schema, triggers, initial RLS policies.
- [x] **Phase 3: Core Repair & Quotation Workflows** — Breakdown intake, diagnostic rules, technician matching, itemized quotes.
- [x] **Phase 4: Operations & Notifications** — Role-specific notification queues, real-time toast alerts, Service Centre dispatch board.
- [x] **Phase 5.1: Product Polish & Account Lifecycle** — Contextual navigation, profile management, atomic account deletion RPC (`a6ff2de`).
- [x] **Phase 5.2: Demo/Data Hygiene & Baseline Reset** — Dual-key atomic `public.reset_demo_data()` RPC, persona isolation, Nagpur geography.
- [x] **Phase 5.3: Notification & Product Communication Polish** — Copy alignment, bounded 25-item queries, user-switch state flushing.
- [x] **Phase 5.4: Governed Cancellation Approval** — Direct cancel for unassigned tickets; review workbench and technician work-holds for active repairs (`d39d821`).
- [x] **Phase 5.5: Communication & Quote Revision** — Ticket-scoped chat (`repair_messages`), Quote v1 vs v2 diffing (`<QuoteComparison />`), canonical `TB-4489` baseline.
- [x] **Phase 5.6: Handover & Completion Polish** — Immediate service history auto-commit upon load testing sign-off; dedicated Closed/Cancelled tabs.
- [x] **Phase 6: Production Readiness & Hardening** — Component error boundaries (`<ComponentErrorBoundary />`), lightbox modal, SEO metadata (`27a1e69`).
- [x] **Phase 7: Realtime Foundation & Concurrency Hardening** — Debounced event coalescing (300ms window) on `postgres_changes`, plus OCC guards (`91b7c83`).
- [x] **Phase 8: Logistics, Route Estimates & Health Monitoring** — Bearer-authenticated health checks (`/api/health`), coarse location intake, device GPS, OSRM route calculations.
- [x] **Phase 9.1: Service Centre Parts Pickup** — Centralized depot catalog, technician pickup requisitions, atomic handoff with row locking, stock audit trail.
- [x] **Phase 9.2: Stock Movement, Sales History & Quote Integration** — Movement ledger (`RECEIVED`, `ISSUED_TO_REPAIR`, `RETURNED`, `ADJUSTMENT`), repair sales history, `catalog_part_id`.
- [x] **Phase 9.3: Unavailable Parts Sourcing & ETA Coordination** — Per-item sourcing ETAs on requisitions, critical-path synchronization to `parts_hold`, out-of-stock handoff locks.
- [x] **Phase 9.4: Dedicated Parts Notifications** — Role-specific in-app notifications for Service Centre, assigned technician, and farmer with privacy boundaries.
- [x] **Phase 10: Profile Security Separation** — Decouple `public.profiles` from `auth.users.id`, segregating credentials in `public.profile_auth_secrets` with zero admin read access.
- [x] **Phase 11: Visual Defect Diagnostics (Google Gemini AI)** — Multimodal tractor damage assessment via Google Gemini 3.5 Flash-Lite, bounded token claims, fail-closed consent, and fail-open submission. *(Status: COMPLETED & STAGING VERIFIED)*
- [ ] **Phase 12: Multilingual Farmer Experience (English + Hindi + Marathi)** — Trilingual farmer interface (English, Hindi, Marathi) with Noto Sans Devanagari typography, language switcher, and Marathi/Hindi/English voice transcription preservation. *(Status: NEXT — PLANNED)*
- [ ] **Phase 13: Technician Trust, Shared Workshops & Accountability** — Independent `repair_facilities`, workshop ownership vs technician membership separation via `facility_memberships`, in-person physical KYC, admin-verified AI skills, verified repair reviews (null defaults). *(Status: PLANNED)*
- [ ] **Phase 14: Smart Dispatch & Emergency Response** — Workshop-based OSRM road distance & driving duration matching, strict ban on straight-line Haversine, dual delivery modes (Doorstep vs Workshop Drop-Off), Immobile machinery lock (`is_immobile = true` -> Doorstep only), bay capacity limits. *(Status: PLANNED)*
- [ ] **Phase 15: Preventive Maintenance Intelligence & Offline Field Reliability** — Rule-based agro-climatic maintenance heuristics (Vidarbha Kharif/Rabi cycles), Service Worker caching, optimistic updates for intermittent rural cellular connectivity. *(Status: PLANNED)*
- [ ] **Phase 16: Master System-Wide QA, E2E Verification & Release Gate** — Multi-role regression suite, load/concurrency stress testing, security audits, release checklist, zero-warning build sign-off. *(Status: PLANNED)*

---

## Detailed Phase Specifications

### Completed Baseline: Phases 1 through 10
*All items fully implemented in application source code, backed by applied Supabase PostgreSQL migrations, and verified through continuous automated testing (144 passing tests in 1.23s, 1.15s SSR / 2.51s client production build, verified on 2026-11-04).*
- **Phases 1–4**: Core architecture, domain relational schema, breakdown reporting, quotation engine, and role dispatch boards.
- **Phases 5.1–5.6**: Account lifecycle, atomic demo reset, notification hygiene, cancellation governance, quote comparison diffing, and permanent service history auto-commit.
- **Phases 6–7**: Component error boundaries, responsive image lightbox, debounced real-time coalescing (300ms window), and Optimistic Concurrency Control.
- **Phase 8**: Route logistics, Bearer-authenticated `/api/health` probes, Nagpur tahsil coordinate mapping, and OSRM driving calculations.
- **Phase 9 (9.1–9.4)**: Full spare-parts supply chain: centralized Nagpur parts depot, technician pickup requisitions with `FOR UPDATE` row locking, stock movement ledger, sourcing ETAs with `parts_hold` critical path, and role-quarantined notifications.
- **Phase 10**: Decoupled `public.profiles` from `auth.users.id`, credentials isolated in `public.profile_auth_secrets` with zero admin read access, and parameterless `get_session_profile()` RPC.

---

### Phase 11: Visual Defect Diagnostics (Google Gemini AI)
**Goal**: Integrate assistive multimodal AI visual diagnostics into equipment breakdown intake using Google Gemini 3.5 Flash-Lite under strict free-tier rate limits, bounded security claims, and robust fail-safe error handling.  
**Status**: **COMPLETED & STAGING VERIFIED**  
**Verification Baseline**: 11 automated tests passing (`tests/diagnostics-contract.test.mjs` and `tests/visual-defect-frontend.test.mjs`), 24 staging acceptance checks, 18 real-image acceptance checks, and 8-step live consent acceptance pass.

#### Completed Deliverables:
1. **Database Schema & Migrations**:
   - `supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql` applied on staging (`ubqgvhcfmrvnmrbllcom`).
   - Created `public.repair_defect_diagnostics` audit table with strict foreign keys to `repair_requests` and `profiles`.
   - Atomic SECURITY DEFINER RPC `verify_diagnostic_claim_token()` validates single-use server-side claim tokens and prevents replay attacks.
   - `public.grant_repair_visual_consent()` and `public.revoke_repair_visual_consent()` manage fail-closed consent lifecycles.
   - RLS policies configured ensuring farmers view diagnostics only for their own tickets, while assigned technicians and service centre staff have authorized visibility.
2. **Server-Side API Route & Gemini Service**:
   - `src/routes/api/assess-visual-defect.ts` handles image ingestion via Nitro serverless endpoint with fail-closed configuration and anti-cross-contamination guards.
   - Authenticates session caller via Supabase Auth (rejects unauthenticated requests with HTTP 401).
   - Validates payload size (bounded $\le 4\text{ MB}$, max 4 photos) and MIME types (`image/jpeg`, `image/png`, `image/webp`).
   - `src/lib/services/gemini-diagnostic.ts` interfaces with Google Gemini 3.5 Flash-Lite with structured Zod schema output, 10s SLA ceiling, in-flight consent cancellation polling, and rate-limit backpressure guards.
3. **Frontend Intake Consent & Safe Submission**:
   - `src/routes/farmer/report-breakdown.tsx`: Implemented fail-closed consent opt-in checkbox (*"Allow AI visual analysis of equipment photos"*). If unselected, image bytes are never transmitted to Gemini.
   - **Fail-Open Breakdown Submission**: AI errors, timeouts, or rate limits never block ticket creation.
   - Cleaned up obsolete video file input and handler stubs; restricted strictly to photos ($\le 4\text{ MB}$).
4. **Interactive Diagnostics UI & Multi-Portal Views**:
   - Developed `<DefectAnnotationCanvas />` (`src/components/diagnostics/defect-annotation-canvas.tsx`) with SVG coordinate bounding boxes, severity badges, and interactive inspection.
   - Developed `<VisualDefectDiagnosticViewer />` (`src/components/diagnostics/visual-defect-diagnostic-viewer.tsx`) with live catalog tractor compatibility matching, assistive disclaimers, and re-scan triggers.
   - Embedded across:
     - Farmer Repair Detail view (`/farmer/repair/$id`)
     - Technician Job Workbench (`/technician/job/$id`)
     - Service Centre Dispatch Detail (`/admin/repair/$id`) with staff force rescan capability.
5. **Environment Separation & Build Isolation**:
   - Established strict staging (`ubqgvhcfmrvnmrbllcom`) vs production (`hwdrypkvszwrcraujctw`) separation.
   - Removed unsafe `"dev:production"` script. Local dev defaults to staging.
   - Automated Vercel build mode dispatcher (`scripts/vercel-build.mjs`) selects `build:staging` for preview and `build:production` for production.

---

### Phase 12: Multilingual Farmer Experience (English + Hindi + Marathi)
**Goal**: Deliver a culturally accessible, trilingual interface tailored to Vidarbha rural operators, focusing localization strictly on the farmer-facing experience while preserving English for technician and service centre administration.  
**Status**: **NEXT — PLANNED**  
**Dependencies**: Phase 11 completion.

#### Scope & Requirements:
1. **Target Languages & Scope**:
   - **Supported Languages**: English (`en`), Hindi (`hi`), and Marathi (`mr`).
   - **Target Audience**: Farmer Portal (`/farmer/*`, breakdown reporting, tracking stepper, quote review, equipment fleet).
   - **Administrative Scope**: Technician and Service Centre administration portals remain strictly in English for this release.
   - **Historical Evolution Note**: Earlier project scoping (ADR-006) temporarily bounded web UI to English + Hindi. In alignment with confirmed Vidarbha operator demographics, Phase 12 extends full farmer UI support to Marathi (`mr`) alongside Hindi and English.
2. **Speech-to-Text & Transcript Canonical Invariant**:
   - Existing Groq Whisper Large V3 voice transcription service maintains automatic multi-language detection across Marathi, Hindi, and English.
   - **Preserve Canonical Spoken Transcript**: Spoken voice input is transcribed in its native spoken language as the canonical record.
   - **No Overwriting**: The system must never automatically overwrite original spoken transcripts with machine translations.
3. **Free-Tier & Zero External Cost Guarantee**:
   - Zero paid translation APIs, commercial SDKs, or external per-token localization services.
   - Lightweight, maintainable, type-safe dictionary mapping (zero heavy runtime i18n bundle overhead).
4. **Typography & Layout Integrity**:
   - Configure **Noto Sans Devanagari** web font stack for proper rendering of Devanagari ligatures and conjuncts across Hindi and Marathi.
   - Zero horizontal overflow or clipped text in Hindi or Marathi on mobile screens (verify with 320px–375px viewports).
5. **Localization Architecture & Preference**:
   - Lightweight, type-safe dictionary approach (zero heavy i18n runtime bundles).
   - Language selector toggle located in Shell header and Farmer dashboard.
   - Persist user language preference in `localStorage` and optionally in `profile.preferred_language`.
6. **Continuous Automated Testing**:
   - Unit tests verifying 100% dictionary key parity across `en`, `hi`, and `mr`.
   - Responsive layout tests ensuring no broken UI components under Devanagari text expansion.

---

### Phase 13: Technician Trust, Shared Workshops & Accountability
**Goal**: Establish enterprise-grade trust, identity verification, shared facility management, and transparent reputation metrics across the technician network.  
**Status**: **PLANNED**  
**Dependencies**: Phase 12 completion.

#### Scope & Requirements:
1. **Shared Workshop & Facility Architecture (`repair_facilities`)**:
   - Introduce independent `public.repair_facilities` table representing physical workshops across Vidarbha.
   - **Role & Ownership Separation**:
     - Workshop Owner/Manager (`owner_profile_id`): Authorized to edit workshop business profile, operating hours, bay capacity, and manage technician memberships.
     - Technician Membership (`public.facility_memberships`): Technicians belong to a workshop as team members with explicit roles: `OWNER`, `MANAGER`, and `TECHNICIAN` (`status = 'ACTIVE'`). A technician does **not** automatically become a workshop administrator.
     - Public Drop-Off Gate (`drop_off_approved`): Controlled exclusively by Service Centre administrators. Workshop owners cannot self-certify their facility for public farmer drop-offs.
     - **Registered Workshop Location Rule**: The technician's operational base is their registered workshop location (`repair_facilities.latitude/longitude`). There is **NO mandatory or continuous live GPS tracking of technicians**.
2. **Privacy-Conscious In-Person Physical KYC**:
   - **Strict Privacy Rule**: Zero Aadhaar document uploads, zero full 12-digit Aadhaar storage, and zero third-party KYC API integrations.
   - **Physical Verification Flow**: Technicians present physical government identity documents in-person at the Nagpur Service Centre.
   - **Database Records**: Service Centre admin verifies identity and records physical verification timestamp, verifying officer ID, and optional non-reversible hash or last-4 digits strictly for auditing. KYC approval executed via admin-only RPC `public.verify_technician_kyc()`.
3. **AI-Assisted Expertise & Certification Verification**:
   - AI evaluates repair history and recommends brand tags (e.g., *Mahindra, Swaraj, John Deere*) and skill endorsements.
   - **Mandatory Admin Approval**: AI-suggested skills **never** automatically become verified profile attributes. They appear in the Service Centre admin approval workbench and require explicit manual sign-off before public display.
4. **Verified Ratings & Reputation System**:
   - **Repair-Gated Reviews**: Reviews can be submitted **only** by farmers who have an immutable, completed `service_history` record with the assigned technician.
   - **No Fake Ratings**: Default technician rating is `NULL` (rendered in UI as *"New / Unrated"*). Static 5.00 default rating is completely eliminated.
   - **Rating Recalculation Trigger**: PostgreSQL trigger recalculates technician average rating and total review count on review INSERT, UPDATE, or DELETE.
   - **Privacy Boundary**: Farmers' private feedback and staff notes are segregated from public aggregate rating displays.
5. **Digital Handover & Equipment Collection**:
   - Load testing verification and digital sign-off protocols for repair completion.
   - Equipment collection authorization validating repair ownership, facility membership, and payment/quote clearance before equipment release.
6. **Continuous Automated Testing**:
   - Test suite verifying RLS policies on `repair_facilities`, `facility_memberships`, and `technician_reviews`.
   - Security tests verifying unverified technicians cannot receive dispatches.
   - Integrity tests confirming unrated technicians display null/unrated without skewing averages.

---

### Phase 14: Smart Dispatch & Emergency Response
**Goal**: Implement intelligent, workshop-based technician dispatch using actual road distances and travel times, supporting both on-field doorstep service and workshop drop-off workflows.  
**Status**: **PLANNED**  
**Dependencies**: Phase 13 completion.

#### Scope & Requirements:
1. **Registered Workshop-Based Routing**:
   - Dispatch distance and travel ETA calculated from the technician's **registered workshop location** (`repair_facilities.latitude/longitude`) to the farmer's breakdown site.
   - **No continuous live GPS tracking of technicians** (respects worker privacy and low-bandwidth environments).
2. **Authoritative OSRM Road Distance Only**:
   - **Strict Ban on Straight-Line Haversine**: Haversine straight-line distance is **strictly prohibited** from the user interface, technician matching algorithms, and service-radius decisions.
   - **Graceful OSRM Outage Fallback**: If the OSRM routing server is unreachable, times out, or returns an error, the UI must display:  
     `"Road Distance Temporarily Unavailable"`  
     *(Under no circumstances shall the system fall back to Haversine in the UI or reject qualified technicians).*
   - **Traffic Disclaimer**: OSRM driving duration is an estimated road driving duration based on standard road speeds without real-time traffic conditions.
3. **Dual Delivery Modes & Immobile Machinery Invariant**:
   - **Flow A: Doorstep / On-Field Service**: Technician travels from workshop to field. Required for immobile machinery.
   - **Flow B: Workshop Drop-Off**: Farmer transports equipment to an approved workshop (`drop_off_approved = true`).
   - **Immobile Machine Decision Gate**: If `is_immobile = true` (machine completely stopped/inoperable), the system **locks service mode to Doorstep only**. Workshop drop-off is disabled, and the farmer is advised not to attempt transport.
   - **Deferred Scope**: Flatbed/towing vehicle dispatch is deferred post-hackathon.
4. **Workshop Bay Capacity Management**:
   - Every facility has a configurable `max_equipment_capacity`.
   - System calculates `current_active_repairs`. If active repairs $\ge$ `max_equipment_capacity`, the workshop is flagged as *"At Capacity"* and temporarily excluded from new drop-off allocations.
5. **Continuous Automated Testing**:
   - Route calculation unit tests with mocked OSRM responses and outage scenarios.
   - State machine tests verifying immobile equipment blocks drop-off selection.
   - Capacity constraint tests ensuring full workshops reject drop-off bookings.

---

### Phase 15: Preventive Maintenance Intelligence & Offline Field Reliability
**Goal**: Equip farmers with seasonal predictive maintenance recommendations tuned to Vidarbha crop calendars, paired with offline-resilient field operation caching.  
**Status**: **PLANNED**  
**Dependencies**: Phase 14 completion.

#### Scope & Requirements:
1. **Vidarbha Agro-Climatic Preventive Maintenance Heuristics**:
   - Rule-based maintenance schedule tuned to regional crop seasons:
     - **Pre-Kharif (May–June)**: Tractor fluid changes, hydraulic pump pressure check, radiator descaling before heavy plowing and sowing (cotton/soybean).
     - **Mid-Season (August)**: Sprayer nozzle calibration, power tiller tines inspection.
     - **Pre-Rabi (October–November)**: Combine harvester cutter bar alignment, thresher drum balance, grain auger lubrication.
   - Generates automated maintenance alerts based on machine operating hours and seasonal milestones.
2. **Offline-Resilient Field Operations**:
   - Lightweight Service Worker caching for active job cards and equipment service history.
   - Optimistic status updates on technician workbench allowing offline inspection notes and checklist completion, queueing mutations for sync upon cellular signal re-acquisition.
3. **Continuous Automated Testing**:
   - Preventive maintenance rules engine test suite verifying seasonal alert triggers.
   - Offline sync queue simulation tests verifying idempotent replay of status updates.

---

### Phase 16: Master System-Wide QA, E2E Verification & Release Gate
**Goal**: Execute comprehensive system-wide quality assurance, multi-role end-to-end regression, security penetration checks, and release gate certification.  
**Status**: **PLANNED**  
**Dependencies**: Phases 11 through 15 completion.

#### Scope & Requirements:
1. **Continuous Testing Architecture (Phases 11–15 $\rightarrow$ Phase 16)**:
   - Automated unit, contract, and integration tests maintained continuously throughout every phase.
   - Never defer testing to Phase 16 alone; each phase must enter Phase 16 with 100% green test passes.
2. **Master Verification Scope**:
   - **Multi-Role End-to-End Scenarios**:
     - Scenario 1: Farmer reports breakdown $\rightarrow$ Gemini visual assessment $\rightarrow$ OSRM matching $\rightarrow$ Technician accepts $\rightarrow$ Quote generated & approved $\rightarrow$ Parts requisition & handoff $\rightarrow$ Load testing sign-off $\rightarrow$ Permanent `service_history` committed $\rightarrow$ Farmer verified review.
     - Scenario 2: Immobile machine on-field emergency dispatch.
     - Scenario 3: Workshop drop-off flow with `RCP-TB-xxxx` check-in receipt and capacity tracking.
   - **Security & Authorization Audit**:
     - Comprehensive RLS policy verification across all 20+ database tables.
     - Zero unauthenticated leaks of farmer GPS, depot costs, or technician auth secrets.
     - Strict verification of admin-only RPCs (`verify_technician_kyc`, `approve_drop_off_facility`).
   - **Performance & Production Build Gate**:
     - Full production build (`npm run build`) in $< 2.0\text{ seconds}$ with zero TypeScript errors and zero bundle warnings.
     - Nitro serverless bundle optimization for instant cold-start execution on Vercel.
     - 100% test suite pass rate across all test files.

---

## Master Progress Table

| Phase | Description | Deliverables / Milestone | Status | Verification Evidence |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | Codebase Cleanup & Doc Reset | Baseline cleanup, TanStack Start + Vite 8 | Completed | Baseline commit |
| **Phase 2** | Domain Database & Security | PostgreSQL 17 schema, initial RLS | Completed | Schema migrations |
| **Phase 3** | Repair & Quote Workflows | Breakdown intake, quote state machine | Completed | Core workflows verified |
| **Phase 4** | Operations & Notifications | Queues, toast alerts, dispatch board | Completed | Real-time events verified |
| **Phase 5.1**| Account Lifecycle & Deletion | Profile settings, atomic deletion RPC | Completed | Commit `a6ff2de` |
| **Phase 5.2**| Demo Hygiene & Reset RPC | Dual-key atomic `reset_demo_data()` | Completed | Persona isolation verified |
| **Phase 5.3**| Notification Polish | Copy alignment, bounded 25-item queries | Completed | Toast & query verification |
| **Phase 5.4**| Cancellation Approval | Governed cancellation, work-holds | Completed | Commit `d39d821` |
| **Phase 5.5**| Chat & Quote Revision | `<RepairChat />`, quote diffing | Completed | Canonical `TB-4489` |
| **Phase 5.6**| Completion & Service History | Auto-commit `service_history`, Closed tabs | Completed | Immediate commit verified |
| **Phase 6** | Production Hardening & SEO | Error boundaries, lightbox modal, SEO | Completed | Commit `27a1e69` |
| **Phase 7** | Realtime Coalescing & OCC | 300ms coalescing, OCC version guards | Completed | Commit `91b7c83` |
| **Phase 8** | Route Logistics (OSRM) & Health | Bearer `/api/health`, Nagpur tahsil OSRM | Completed | Commit `b4e4289` (21 tests) |
| **Phase 9.1**| Service Centre Parts Pickup | Depot inventory, pickup requisitions | Completed | 105 tests passing |
| **Phase 9.2**| Stock Movements & Sales | Movement ledger, sales history, catalog IDs | Completed | Verified in test suite |
| **Phase 9.3**| Unavailable Parts & ETAs | Sourcing ETAs, `parts_hold` synchronization | Completed | Verified in test suite |
| **Phase 9.4**| Parts Notifications | Role-specific parts alerts & boundaries | Completed | Verified in test suite |
| **Phase 10** | Profile Security Separation | Decoupled `profiles`, `profile_auth_secrets` | Completed | 28 tests passing |
| **Phase 11** | Visual Defect Diagnostics (AI) | Gemini 3.5 Flash-Lite, `<DefectAnnotationCanvas />`, `<VisualDefectDiagnosticViewer />`, fail-closed consent, fail-open breakdown submission, staging separation | **Completed** | 160 tests passing, 24 staging checks, 18 real-image checks, 8 consent checks |
| **Phase 12** | Multilingual Farmer Experience | Trilingual Farmer UI (English, Hindi, Marathi), Noto Sans Devanagari, voice input preserved | **Next** *(Planned)* | Ready for implementation; dependencies satisfied |
| **Phase 13** | Technician Trust & Workshops | `repair_facilities`, `facility_memberships` (OWNER/MANAGER/TECHNICIAN), registered workshop location, in-person KYC, admin AI approval, verified ratings | Planned | Pending Phase 12 |
| **Phase 14** | Smart Dispatch & Routing | Registered workshop OSRM routing, Haversine ban, Doorstep vs Drop-off, Immobile lock, bay capacity | Planned | Pending Phase 13 |
| **Phase 15** | Preventive Maintenance & Offline| Vidarbha crop heuristics, offline caching | Planned | Pending Phase 14 |
| **Phase 16** | Master QA & Release Gate | System regression, E2E validation, release readiness | Planned | Final release gate |

---

*Roadmap updated: 2026-11-06 — Fully synchronized with Master Project Architecture & Verified Staging Baseline (160 passing tests in 1.10s, 0 errors, 1.25s SSR / 2.69s client build on 2026-11-06)*