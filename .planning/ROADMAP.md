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
- [x] **Phase 12: Multilingual Farmer Experience (English + Hindi + Marathi)** — Trilingual farmer interface (English, Hindi, Marathi) with Noto Sans Devanagari typography, language switcher, and Marathi/Hindi/English voice transcription preservation. *(Status: COMPLETED & STAGING VERIFIED)*
- [ ] **Phase 13: Technician Trust, Shared Workshops & Accountability** — Independent `repair_facilities`, workshop ownership vs technician membership separation via `facility_memberships`, in-person physical KYC, admin-verified AI skills, verified repair reviews (null defaults), digital handover & equipment collection. *(Status: IN PROGRESS — Milestones 1–5 Complete)*
- [ ] **Phase 14: Smart Dispatch & Emergency Response** — Workshop-based OSRM road distance & driving duration matching, strict ban on straight-line Haversine, dual delivery modes (Doorstep vs Workshop Drop-Off), Immobile machinery lock (`is_immobile = true` -> Doorstep only), bay capacity limits. *(Status: PLANNED)*
- [ ] **Phase 15: Preventive Maintenance Intelligence & Offline Field Reliability** — Rule-based agro-climatic maintenance heuristics (Vidarbha Kharif/Rabi cycles), Service Worker caching, optimistic updates for intermittent rural cellular connectivity. *(Status: PLANNED)*
- [ ] **Phase 16: Frontend UI/UX Improvement & Product Polish** — Comprehensive frontend visual consistency, public homepage redesign and subsequent trilingual localisation (English, Hindi, Marathi), role portal polish (Farmer, Technician, Service Centre), mobile (320px–375px)/tablet/desktop responsiveness, Devanagari typography & text expansion resilience, touch targets ($\ge 44\text{px}$), accessible forms/validation, and loading/empty/error states. *(Status: PLANNED)*
- [ ] **Phase 17: Master System-Wide QA, Production Migration & Release Gate** — Multi-role regression suite, load/concurrency stress testing, security audits, governed production database migration rehearsal and execution (`hwdrypkvszwrcraujctw`), free-tier manual backup & reverse DDL rollback procedures, release checklist, zero-warning build sign-off. *(Status: PLANNED)*

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
**Status**: **COMPLETED & STAGING VERIFIED**  
**Dependencies**: Phase 11 completion.  
**Verification Baseline**: 171 automated tests passing (`npm test` in ~1.20s), clean production build (1.20s), 15/15 responsive viewport passes (320px–1440px across EN/HI/MR with zero horizontal overflow), 100% dictionary key parity (208 keys across en/hi/mr), canonical Whisper Large V3 voice transcription preservation, single header selector (`EN` / `हिं` / `म`), and controlled staging demo reset verified.

#### Completed Deliverables:
1. **Trilingual Localization Architecture (`en`, `hi`, `mr`)**:
   - Zero-overhead, type-safe dictionary mapping (`src/lib/i18n/dictionaries/` for `en.ts`, `hi.ts`, `mr.ts`) with `TranslationKey` type safety.
   - 100% dictionary key parity across 208 keys, with verified Devanagari script presence for Hindi and Marathi.
   - Comprehensive coverage across Farmer Portal routes: `/farmer`, `/farmer/report-breakdown`, `/farmer/equipment`, `/farmer/equipment/$id`, and `/farmer/repair/$id`.
   - Name & Identity preservation: dynamic user names, equipment brands/models, job IDs, phone numbers, and dates remain untransliterated in canonical form.
2. **Compact Navigation Language Selector**:
   - Single placement exclusively in the Farmer Portal top navigation header (`src/components/farmer-language-selector.tsx`). Duplicate dashboard selector removed.
   - Compact segmented UI displaying `EN` / `हिं` / `म` with `aria-label` accessibility ("English", "Hindi", "Marathi") and zero Lucide globe icon.
   - Client-side reactive switching without page reloads; preference persisted in `localStorage` (`terrabyte_farmer_lang`).
3. **Typography & Layout Integrity (Noto Sans Devanagari)**:
   - Configured `Noto Sans Devanagari` font family in CSS and HTML root for correct rendering of Devanagari ligatures and conjuncts.
   - Responsive verification across 5 screen sizes (320px, 375px, 768px, 1024px, 1440px) confirmed zero horizontal scroll overflow across all 3 languages.
4. **Canonical Voice Transcription Preservation**:
   - Groq Whisper Large V3 service maintains automatic multi-language detection across Marathi, Hindi, and English without hardcoded language constraints.
   - Spoken farmer voice descriptions appended directly to text input as canonical record, never overwritten by machine translation.
   - Strict $0.00 Free-Tier guarantee with zero paid external translation APIs.
5. **Reset Demo Authorization & Staging Verification**:
   - Hardened `handleExecuteReset` in `src/components/tb.tsx` with explicit error propagation and strict `rpcResult.success` verification.
   - Applied staging forward migration `20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql` pairing staging demo accounts (`*.staging@terrabyte.app`) with canonical UUIDs.
   - Executed controlled staging reset exactly once, successfully restoring baseline: 3 equipment, 5 depot parts, 0 active repairs.
   - Documented production migration safety findings: migration is staging-specific and must not be applied as-is to production (`hwdrypkvszwrcraujctw`).

---

### Phase 13: Technician Trust, Shared Workshops & Accountability
**Goal**: Establish enterprise-grade trust, identity verification, shared facility management, and transparent reputation metrics across the technician network.  
**Status**: **NEXT — PLANNED**  
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

### Phase 16: Frontend UI/UX Improvement & Product Polish
**Goal**: Deliver a comprehensive frontend visual, ergonomic, and accessibility overhaul across all TerraByte user interfaces (including public homepage, Farmer, Technician, and Service Centre), elevating the application to an aesthetically refined, highly intuitive, production-grade agricultural technology standard.  
**Status**: **PLANNED**  
**Dependencies**: Phase 15 completion (all feature workflows stabilized).

#### Scope & Requirements:
1. **Public Homepage Redesign & Multilingual Implementation**:
   - The public TerraByte homepage/landing page (`/`) is explicitly included in Phase 16 and must strictly adhere to the following sequence:
     1. Redesign the public homepage and finalize its visual hierarchy, UX, value proposition, and persona entry points.
     2. Implement trilingual localisation (English, Hindi, and Marathi) against the finalized redesigned interface.
     3. Ensure all homepage content, navigation headers, action buttons, feature sections, FAQs, and user-facing messages are fully translated.
     4. Integrate the language selector consistently with the final public design (accessible in the public navigation).
     5. Verify responsive layouts and Devanagari typography across 320px–375px mobile, tablet, and desktop viewports.
     6. Add automated translation key parity and language-switching tests covering the public homepage dictionary.
   - *Phase Boundary Invariant*: Phase 12 scope remains strictly bounded to the Farmer Portal. Public homepage localisation belongs exclusively to Phase 16 after its visual redesign.
2. **Design System & Visual Consistency**:
   - Establish a unified visual hierarchy, high-contrast palette calibrated for outdoor sunlight readability, consistent spacing tokens, and clean typography.
   - Refine component styling across buttons, badges, chips, dialogs, sheets, and notification toasts.
   - Harmonize card treatments, elevation, and border radii across all portals.
3. **Multi-Role Portal Usability & Information Architecture**:
   - **Farmer Portal**: Streamline breakdown reporting wizard, clarify 7-step repair tracking stepper, elevate itemized quote approval cards, and enhance equipment fleet cards.
   - **Technician Workbench**: Optimize mobile task workflow, touch-friendly checklist inputs, clear visual defect diagnostic overlays, and seamless parts requisition management.
   - **Service Centre Operations**: Improve tabular density and readability on the dispatch board, responsive inspection modals, and clear visual indicators for parts holds and stock levels.
4. **Responsive Viewports & Touch Usability**:
   - Flawless mobile layouts across 320px, 375px, 414px, 768px tablet, and desktop viewports.
   - Enforce minimum $\ge 44\text{px} \times 44\text{px}$ touch targets across all mobile buttons, action chips, and form controls for reliable field operation with gloved or rough hands.
   - Eliminate horizontal scrollbars, text clipping, and misaligned flex/grid layouts on small viewports.
5. **Devanagari Font Rendering & Text Expansion**:
   - Ensure proper glyph, conjunct, and ligature rendering of Noto Sans Devanagari in both Hindi and Marathi.
   - Accommodate 20%–40% text expansion in regional languages without layout breakage, awkward wrapping, or truncated action buttons.
6. **UI State Polish (Loading, Empty, Error & Feedback)**:
   - Replace generic spinners with contextual skeleton loaders matching actual card/table layouts.
   - Design helpful, illustrated empty states with direct primary call-to-action buttons.
   - Implement graceful error boundaries with actionable retry controls and clear non-technical explanations.
   - Add polished micro-interactions and clear affirmative feedback on critical actions (breakdown logged, quote approved, handoff confirmed).
7. **Continuous Automated Verification**:
   - Automated layout regression tests verifying zero horizontal overflow at 320px/375px.
   - Accessibility contract tests verifying WCAG 2.1 AA color contrast and tap target sizing.
   - Translation key parity tests for public homepage dictionaries (`en`, `hi`, `mr`).

---

### Phase 17: Master System-Wide QA, Production Migration & Release Gate
**Goal**: Execute comprehensive system-wide quality assurance, multi-role end-to-end regression, security penetration checks, governed production database migration (`hwdrypkvszwrcraujctw`), and release gate certification.  
**Status**: **PLANNED**  
**Dependencies**: Phases 11 through 16 completion.

#### Scope & Requirements:
1. **Continuous Testing Architecture (Phases 11–16 $\rightarrow$ Phase 17)**:
   - Automated unit, contract, and integration tests maintained continuously throughout every phase.
   - Never defer testing to Phase 17 alone; each phase must enter Phase 17 with 100% green test passes.
2. **Master Verification Scope**:
   - **Multi-Role End-to-End Scenarios**:
     - Scenario 1: Farmer reports breakdown $\rightarrow$ Gemini visual assessment $\rightarrow$ OSRM matching $\rightarrow$ Technician accepts $\rightarrow$ Quote generated & approved $\rightarrow$ Parts requisition & handoff $\rightarrow$ Load testing sign-off $\rightarrow$ Permanent `service_history` committed $\rightarrow$ Farmer verified review.
     - Scenario 2: Immobile machine on-field emergency dispatch.
     - Scenario 3: Workshop drop-off flow with `RCP-TB-xxxx` check-in receipt and capacity tracking.
     - Scenario 4: Governed cancellation lifecycle with Service Centre review and technician work-holds.
   - **Security & Authorization Audit**:
     - Comprehensive RLS policy verification across all database tables.
     - Zero unauthenticated leaks of farmer GPS, depot costs, or technician auth secrets.
     - Strict verification of admin-only RPCs (`verify_technician_kyc`, `approve_drop_off_facility`).
   - **Performance & Production Build Gate**:
     - Full production build (`npm run build`) in $< 2.0\text{ seconds}$ with zero TypeScript errors and zero bundle warnings.
     - Nitro serverless bundle optimization for instant cold-start execution on Vercel.
     - 100% test suite pass rate across all test files.
3. **Governed Production Migration & Release Execution (`hwdrypkvszwrcraujctw`)**:
   - **Environment Context**:
     - Staging Supabase: `ubqgvhcfmrvnmrbllcom` (all existing migrations applied and verified).
     - Production Supabase: `hwdrypkvszwrcraujctw` (production migration ledger is formally **unverified**; confirmed only that Phase 11 visual diagnostics and subsequent migrations have not been applied; direct production queries prohibited).
   - **Production Migration Inventory Classification**:
     - *Existing Migration Files Pending Production*:
       - `20261103120000_phase11_visual_defect_diagnostics.sql` (Phase 11 diagnostics table, consent RPCs, claim tokens).
       - Forward migrations on disk (`20261104100000_profile_security_separation.sql`, `20261104110000_complete_phase9_parts_desk_rpcs.sql`, `20261104120000_complete_phase9_realtime_and_eta.sql`, `20261104130000_complete_phase5_3_technician_registration_notification.sql`).
     - *Planned Future Migrations (Not Yet Created)*:
       - Future Phase 13 migrations (facilities, memberships, KYC).
       - Future Phase 14 migrations (smart dispatch, bay capacity).
       - Future Phase 15 migrations (preventive maintenance).
       *(Note: Future migrations must not be assigned speculative filenames or execution orders until authored in their respective phases).*
   - **Schema & Existing Data Compatibility**:
     - Zero destructive column alterations, table drops, or schema mutations.
     - Safe column whitelists (Phase A fallback architecture ensures zero downtime if PostgREST schema cache reload experiences transient delays).
     - Ensure production scripts are cleansed of hardcoded test UUIDs, synthetic seed records, or staging credentials.
   - **Production Verification & Post-Migration Smoke Test**:
     - Execute migration pipeline via Supabase CLI against production (`hwdrypkvszwrcraujctw`) only during formal release window.
     - Run production smoke verification suite (`scripts/production-smoke-test.mjs`):
       - GoTrue authentication and profile resolution.
       - RLS isolation verification (farmer cannot read depot costs or other farmers' GPS).
       - Gemini AI visual diagnostics API endpoint readiness.
       - OSRM route estimation health probe.
   - **Backup, Recovery & Rollback (Strict $0.00 Free-Tier Compliance)**:
     - *Free-Tier Backup*: Manual logical SQL backup (`pg_dump`) executed locally prior to applying any production migrations.
     - *No Paid Dependencies*: Zero reliance on Point-in-Time Recovery (PITR is a paid add-on and excluded under the $0.00 budget invariant).
     - *Manual Reverse Rollback*: Discrete, pre-tested reverse DDL rollback scripts authored and validated for every applied migration file.
     - *Immediate Contingency*: Pre-migration SQL snapshot retained locally for manual restoration if critical errors occur.

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
| **Phase 12** | Multilingual Farmer Experience | Trilingual Farmer UI (English, Hindi, Marathi), Noto Sans Devanagari, voice input preserved, staging reset paired auth | **Completed** | 171 passing tests, 15/15 responsive viewports, staging demo reset verified |
| **Phase 13** | Technician Trust & Workshops | `repair_facilities`, `facility_memberships` (OWNER/MANAGER/TECHNICIAN), registered workshop location, in-person KYC, admin AI approval, verified ratings, digital handover & collection | **In Progress** *(Milestones 1–5 Complete)* | M1 database committed `80537c6`, M2 shared workshop committed `e0aeaa0`, M3 in-person physical KYC committed `45121f5`, M4 verified reviews committed, M5 digital handover verified (294 tests passing) |
| **Phase 14** | Smart Dispatch & Routing | Registered workshop OSRM routing, Haversine ban, Doorstep vs Drop-off, Immobile lock, bay capacity | Planned | Pending Phase 13 |
| **Phase 15** | Preventive Maintenance & Offline| Vidarbha crop heuristics, offline caching | Planned | Pending Phase 14 |
| **Phase 16** | Frontend UI/UX & Polish | Public homepage redesign & trilingual localisation (EN/HI/MR), role portals, 320px–375px mobile, Devanagari resilience, touch targets, state polish | Planned | Pending Phase 15 |
| **Phase 17** | Master QA, Prod Migration & Gate | System regression, E2E validation, governed production migration (hwdrypkvszwrcraujctw), release certification | Planned | Final release gate |

---

*Roadmap updated: 2026-11-07 — Fully synchronized with Master Project Architecture & Verified Staging Baseline (294 passing tests in 1.71s, 0 errors, production build verified on 2026-11-07)*