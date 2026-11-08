# TerraByte — Master Project State

## 1. Project Reference & System Overview

- **Project**: TerraByte — Agricultural Equipment Repair Coordination Ecosystem
- **Anchor Region**: Nagpur District & Vidarbha Agrarian Heartland, Maharashtra (Katol, Saoner, Umred, Hingna)
- **Core Mission**: Dramatically compress the time between agricultural machinery breakdown and getting back to work in the field.
- **Technology Stack**: React 19 SPA + TanStack Start / Router + Vite 8 + Nitro (`vercel` preset) + Supabase (Auth, PostgreSQL 17, Storage, Realtime) + Google Gemini API (Visual Diagnostics).
- **Free-Tier Constraint**: 100% Free-Tier compatible ($0.00 spend). Zero paid fallback services, zero automatic billing upgrades, and zero unexpected charges.

---

## 2. Current Position & Milestone Status

- **Current Phase**: **Phase 14 — Smart Dispatch & Workshop Drop-Off (IN PROGRESS — MILESTONES 1, 2, 3 & 4 SIGNED OFF; MILESTONE 5 IMPLEMENTED & VERIFIED, AWAITING SIGN-OFF)**
- **Branch**: `phase-14` (Created from completed `phase-13` base commit `f14c2e0`; strictly additive Git history, no force-pushing/rebasing)
- **Status Summary**:
  - Phases 1–10: **COMPLETED & VERIFIED**
  - Phase A (Auth Recovery): **COMPLETED & VERIFIED** — Resolved all 18 `get_session_profile` call sites across 14 modules with safe column fallback (`profiles.id, role, full_name, phone, village`), zero DB modifications, and verified mock client recovery.
  - Phase 11 (Visual Diagnostics): **COMPLETED & VERIFIED ON STAGING** — Dedicated Supabase staging (`ubqgvhcfmrvnmrbllcom`), 18 tables, 49 RLS policies, synthetic seed fixtures, interactive `DefectAnnotationCanvas`, multi-portal `VisualDefectDiagnosticViewer`, fail-closed consent opt-in, fail-open breakdown submission, live catalogue tractor compatibility matching, and staff force rescan lifecycle verified end-to-end. Production (`hwdrypkvszwrcraujctw`) strictly air-gapped and untouched.
  - Phase 12 (Multilingual Experience): **COMPLETED & VERIFIED ON STAGING** — Trilingual Farmer Portal (English, Hindi, Marathi) with 100% dictionary key parity (208 keys), Noto Sans Devanagari typography, compact top-nav segmented selector (`EN` / `हिं` / `म`), canonical Groq Whisper Large V3 voice transcription preservation, responsive 320px–1440px overflow immunity, and verified staging Reset Demo RPC paired authorization.
  - Phase 13: **COMPLETED — LOCAL INTEGRATION VERIFIED; PENDING REMOTE STAGING GATE (ALL MILESTONES 1–6 COMPLETE)** (Technician Trust, Shared Workshops, Verified Reviews & Digital Handover: M1 Database Foundations committed `80537c6`, M2 Shared Workshop Governance committed `e0aeaa0`, M3 Physical KYC committed `45121f5`, M4 Verified Reviews & Technician Ratings committed `5483fd8` / `bbdff3c`, M5 Digital Handover & Equipment Collection committed `f3865a1`, M6 Integration & Staging QA verified across 299 tests. Remote staging database migration pending explicit operator execution).
  - Phase 14: **IN PROGRESS — M1, M2, M3 & M4 SIGNED OFF; M5 IMPLEMENTED & VERIFIED (AWAITING SIGN-OFF)**
    - **Milestone 1 (Database Foundation & Domain Invariants)**: Formally approved and signed off (22 live PostgreSQL integration tests pass, sequence `drop_off_receipt_seq`, table `facility_bay_reservations`, 6 SECURITY DEFINER RPCs with search path hardening, server-side transactional FIFO priority queue).
    - **Milestone 2 (Workshop-Origin OSRM Routing & Matching Integration)**: **FORMALLY SIGNED OFF BY USER APPROVAL** (15/15 tests in `tests/phase-14-routing-and-matching.test.mjs`, 21/21 in `tests/route-estimate.test.mjs`, 369/369 full workspace suite, clean production build). Implements Option C Qualification-First Ranking (Brand 40, Skill 30, Availability 20; max 90; proximity 0), registered workshop origin (`primary_facility_id` -> `repair_facilities`), hardcoded `0 km · ~45 min` default eliminated, `NO_COORDINATES` gate with 0 network fetch, `OUTAGE` graceful non-disqualification, zero stale metrics, strict zero Haversine ban, Extended Travel (> 50 km) tag, mandatory rural traffic disclaimer (`"Estimated standard driving duration. Real-time rural road and weather conditions may vary."`), and deterministic 6-tier tie-breaking.
    - **M2 Live Read-Only Staging Manual QA Execution (2026-11-08)**: Authorized read-only staging check executed. Staging authentication succeeded (`ubqgvhcfmrvnmrbllcom.supabase.co`). All three live checks were BLOCKED due to absence of active staging repair/job data (`repairs = []` for farmer; `assignedJobs = []` for technician). Zero staging writes performed. All four follow-up checks remain active and tracked in the Deferred QA Register (`Deferred M2-QA-01` through `M2-QA-04`) in `docs/audits/phase-14/PHASE14_MILESTONE2_MANUAL_TESTING_CHECKLIST.md` and must NOT be marked complete.
    - **Milestone 3 (Farmer Intake Wizard Dual Delivery & Immobile Machinery Lock)**: **FORMALLY SIGNED OFF BY USER APPROVAL** (Farmer intake wizard delivery mode selection, immobile machinery lock to DOORSTEP, 6-scenario forged submission database attack guards in `20261108180000_phase14_m3_strict_dropoff_integrity.sql`, 7/7 intake tests, 20/20 live DB attack tests, 100% trilingual dictionary parity).
    - **Milestone 4 (Workshop Drop-Off Lifecycle, Check-in Receipt & Bay Occupancy)**: **FORMALLY SIGNED OFF BY USER APPROVAL** (Complete M4 service layer in `src/lib/services/facility-capacity.ts`, printable custody receipt modal `RCP-TB-YYYYMMDD-XXXX`, intake checkin dialog, admin extension/rerouting/release dialogs, workshop operations desk in `/admin/facilities`, multi-portal integration in admin/farmer/technician routes, 10 new trilingual keys with 100% parity across 270 keys, 18/18 live PostgreSQL tests in `tests/phase-14-m4-dropoff-lifecycle.test.mjs`, 415/415 full workspace tests pass, clean production build; user sign-off granted).
    - **Milestone 5 (Manual Technician Dispatch & Reassignment)**: **AUDITED & VERIFIED — AWAITING USER SIGN-OFF** (Forward migration `20261109000000_phase14_m5_manual_dispatch_and_reassignment.sql` applied to local DB; audit table `repair_assignment_history` with RLS; DAC revoking direct client update of `technician_id`; trusted RPC `admin_dispatch_technician` with row lock `FOR UPDATE`, OCC token `p_expected_current_technician_id`, duplicate check, terminal/handover state locks, mandatory reason on reassignment, dual-table logging; dedicated `farmer_request_technician` RPC preserving farmer technician nomination; RPC `get_repair_assignment_history`; service layer in `src/lib/services/technicians.ts`; UI components `ManualDispatchDialog` and `AssignmentHistoryCard` integrated into `/admin/repair/$id`; 15/15 dedicated PostgreSQL tests pass in `tests/phase-14-m5-dispatch.test.mjs`; 131/131 Phase 14 tests pass; 430/430 workspace tests pass; clean production build).
    - **Production Migration Timing**: Production database migration and data replacement are scheduled strictly for Phase 17 (after Phase 14 M5 and Phase 16).
  - Phases 15–17: **PLANNED** (Future phases; not yet implemented)
  - Post-Hackathon: **DEFERRED** (Payments, WhatsApp bot, OEM telematics, FPO networks, towing/flatbed recovery, external ERP inventory)

```text
Progress: [████████████████████] 100% (Phase 14 Milestones 1, 2, 3, 4 Signed Off; Milestone 5 Implemented & Verified)
```

---

## 3. Verified Empirical Test & Build Health

The following figures were verified live via empirical command execution on **2026-11-09**:

- **Automated Test Suite (`npm test`)**:
  - Total Tests: **430**
  - Passing Tests: **430** (0 failures, 0 skipped, 0 cancelled)
  - Execution Duration: **2.75s**
  - Test Suites Covered: 24 suites (`auth-production-compatibility`, `cleanup-verification`, `diagnostics-contract`, `i18n-dictionary-parity`, `parts-desk`, `parts-matching`, `profile-security-architecture`, `route-estimate`, `visual-defect-frontend`, `phase-13-db-invariants`, `phase-13-workshop-management`, `phase-13-demo-remediation`, `phase-13-kyc-and-skills`, `phase-13-reviews-and-ratings`, `phase-13-auth-review-security`, `phase-13-handover-and-collection`, `phase-13-milestone6-integration-e2e`, `phase-14-db-invariants`, `phase-14-live-postgres`, `phase-14-routing-and-matching`, `phase-14-intake-and-immobile`, `phase-14-m3-live-db`, `phase-14-m4-dropoff-lifecycle`, `phase-14-m5-dispatch`)
- **Real-Image Acceptance Suite (`scratch/phase-11/run_real_image_acceptance.mjs`)**:
  - Live Tests: **18/18 PASS** (Genuine tractor engine bay photograph, CC BY 4.0, zero PII, 2.84 MB, farmer consent, live `gemini-3.5-flash-lite` 4324ms, zero defect hallucination, non-authoritative zero spurious parts commitment, multi-portal queries, 30s cooldown enforcement, staff force rescan, audit history archival)
- **Staging & Gemini Acceptance Suite (`scratch/phase-11/run_phase11_acceptance.mjs`)**:
  - Live Tests: **24/24 PASS** (GoTrue auth sessions, fail-closed consent, concurrency locks, live `gemini-3.5-flash-lite` multimodal response, catalogue compatibility filtering, technician force rescan, admin corruption recovery)
- **Phase 12 Responsive Viewport Suite (`scratch/phase-12/test_responsive_viewports.mjs`)**:
  - Viewports: **15/15 PASS** (320x568, 375x667, 768x1024, 1024x768, 1440x900 across English, Hindi, and Marathi with 0px horizontal scroll overflow)
- **Production Build (`npm run build:production`)**:
  - Status: **SUCCESS** (TanStack Start + Vite 8.1.5 + Nitro `vercel` serverless preset, 1.32s SSR / 3.35s client build, 0 errors, 0 warnings)
  - Compiler: Vite 8.1.5 + Nitro (preset: `vercel`)
  - Output Target: `.vercel/output` (Serverless bundle)

---

## 4. Phase-by-Phase Roadmap Status (Phases 1–17)

| Phase | Milestone Name | Status | Verified Deliverables / Primary Evidence |
| :---: | :--- | :---: | :--- |
| **Phase 1** | Codebase Cleanup & Baseline Reset | **COMPLETED** | TanStack Start v1 + React 19 clean baseline, Vite 8 bundler, zero framework sprawl. |
| **Phase 2** | Domain Database & Security Hardening | **COMPLETED** | PostgreSQL 17 relational schema, 11 core tables, RLS policies, update triggers. |
| **Phase 3** | Core Repair & Quotation Workflows | **COMPLETED** | 2-min breakdown intake, preliminary triage rules, itemized quotes, mandatory farmer approval. |
| **Phase 4** | Operations & Notifications | **COMPLETED** | Service Centre dispatch board, role-specific notification queues, real-time toast alerts. |
| **Phase 5** | Product Polish, Demo Reset & Completion | **COMPLETED** | Subphases 5.1–5.6: Account deletion (`delete_user_account`), dual-key demo reset (`reset_demo_data`), ticket chat (`repair_messages`), quote revision diffing, service history auto-commit (`INV-TB-xxxx`). |
| **Phase 6** | Production Readiness & UI Hardening | **COMPLETED** | Component error boundaries (`<ComponentErrorBoundary />`), photo lightbox modal, SEO metadata (`27a1e69`). |
| **Phase 7** | Realtime Synchronization & OCC | **COMPLETED** | Debounced 300ms event coalescing on Supabase `postgres_changes`, Optimistic Concurrency Control guards (`91b7c83`). |
| **Phase 8** | Route Logistics (OSRM) & Health | **COMPLETED** | In-app OSRM driving distance/ETA (`/api/route-estimate`), village/tahsil intake, timing-safe Bearer health check (`/api/health`). |
| **Phase 9** | Spare-Parts Logistics & Sourcing | **COMPLETED** | Subphases 9.1–9.4: Central Nagpur Depot catalog (`service_centre_parts`), pickup requisitions, atomic stock decrement with row locking, movement audit ledger, sourcing ETAs (`parts_hold`), verified across 105 tests. |
| **Phase 10** | Profile Security Separation | **COMPLETED** | Decoupled `public.profiles` from auth IDs, segregated secrets in `public.profile_auth_secrets` with zero admin read access, parameterless `get_session_profile()` RPC, verified across 28 tests. |
| **Phase A** | Authentication Recovery & RPC Fallback | **COMPLETED** | Resilient production fallback across 14 modules resolving missing `get_session_profile` RPC / schema cache (`PGRST202`), safe column whitelist, persona reconstruction, 10 compatibility tests pass. |
| **Phase 11** | Gemini AI Visual Diagnostics | **COMPLETED & STAGING VERIFIED** | Multimodal Gemini 3.5 Flash-Lite integration, interactive `DefectAnnotationCanvas`, `VisualDefectDiagnosticViewer` across farmer/tech/admin portals, fail-closed consent, fail-open breakdown submission, live catalogue matching, and staging acceptance verification (`docs/audits/phase-11/PHASE_11_STAGING_ACCEPTANCE_REPORT.md`). |
| **Phase 12** | Multilingual Farmer Experience | **COMPLETED & STAGING VERIFIED** | Trilingual Farmer Portal (`en` \| `hi` \| `mr`), 100% dictionary key parity (208 keys), Noto Sans Devanagari typography, compact top nav selector (`EN` / `हिं` / `म`), canonical Groq Whisper Large V3 voice transcription preservation, 15/15 responsive viewport passes, and verified staging Reset Demo RPC paired authorization. |
| **Phase 13** | Technician Trust, Physical KYC & Workshops | **COMPLETED (LOCAL VERIFIED)** | In-person physical KYC at Nagpur Service Centre (zero Aadhaar storage), independent `repair_facilities`, multi-tech memberships, verified ratings (null default, recalculation triggers), structured load-test sign-off, offline payment clearance, location privacy gate, digital handover & equipment collection receipt (`docs/audits/phase-13/PHASE13_MILESTONE6_INTEGRATION_QA_REPORT.md`). Remote staging migration pending operator approval. |
| **Phase 14** | Smart Dispatch & Workshop Drop-Off | **IN PROGRESS (M1, M2 & M3 SIGNED OFF; M4 IMPLEMENTED & VERIFIED, PENDING USER REVIEW)** | M1 Database Foundation formally approved (22 live PostgreSQL integration tests pass). Milestone 2 formally signed off by user approval (Option C Qualification-First Ranking, registered workshop origin, hardcoded 0km/45m eliminated, rural traffic disclaimer, 6-tier tie-breaking; 4 active deferred QA checks M2-QA-01 to M2-QA-04). Milestone 3 formally signed off by user approval (farmer intake wizard delivery mode, immobile machinery lock to DOORSTEP, 6-scenario forged submission database attack guards in `20261108180000_phase14_m3_strict_dropoff_integrity.sql`, 7/7 unit tests, 20/20 live DB attack tests). Milestone 4 implemented and verified (complete M4 service layer in `facility-capacity.ts`, custody receipt modal `RCP-TB-YYYYMMDD-XXXX`, intake checkin dialog, admin dialogs for extension/rerouting/release, workshop operations desk in `/admin/facilities`, multi-portal integration in admin/farmer/tech routes, 10 trilingual keys with 100% parity across 270 keys, 9/9 live DB tests in `phase-14-m4-dropoff-lifecycle.test.mjs`, 406/406 workspace tests pass, clean production build; awaiting user review). Milestone 5 unstarted. |
| **Phase 15** | Preventive Maintenance Intelligence | **PLANNED** | Machinery operating-hour alerts (50h, 250h, 500h, 1000h intervals), Vidarbha seasonal crop advisory calendar, 1-click maintenance package booking. |
| **Phase 16** | Frontend UI/UX Improvement & Product Polish | **PLANNED** | Public homepage redesign and subsequent trilingual localisation (EN/HI/MR), visual consistency overhaul, multi-role portal polish (Farmer, Tech, Admin), 320px–375px mobile responsiveness, $\ge 44\text{px}$ touch targets, Devanagari expansion resilience, accessible states. |
| **Phase 17** | Master System-Wide QA, Production Migration & Release Gate | **PLANNED** | Master stabilization gate, full regression run, multi-role staging rehearsal, governed production migration (hwdrypkvszwrcraujctw), backup/rollback playbook, zero critical/high severity bugs sign-off. |

---

## 5. Phase 11 & Phase A Verified Implementation Status

### Completed in Phase 11 (Gemini AI Visual Defect Diagnostics)
- **Database Layer**: `supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql` (implements atomic claim token `claim_repair_visual_diagnostic`, fail-closed consent state machine `grant_repair_visual_consent` / `revoke_repair_visual_consent`, service-role finalizer `save_repair_visual_diagnostic`, and sanitized failure recorder `finalize_repair_visual_diagnostic_failure`).
- **Server Service Layer**: `src/lib/services/gemini-diagnostic.ts` (photo bounding to 4 MB / max 4 photos, prompt with Nagpur depot parts catalog context, Gemini 3.5 Flash-Lite REST execution, timeout abort controller, 750ms in-flight consent cancellation poller).
- **API Endpoint**: `src/routes/api/assess-visual-defect.ts` (Bearer auth validation, profile resolution with resilient fallback, claim verification).
- **Frontend Client Service**: `src/lib/services/visual-diagnostics-client.ts` (`assessRepairVisualDefect`, payload construction, error handling).
- **Interactive UI Components**: `src/components/diagnostics/defect-annotation-canvas.tsx` (SVG coordinate mapping, bounding boxes, severity badges) and `src/components/diagnostics/visual-defect-diagnostic-viewer.tsx` (findings, recommended depot parts, retry triggers).
- **Multi-Portal Integration**: Integrated into `src/routes/farmer/report-breakdown.tsx` (consent opt-in, fail-open submission), `src/routes/farmer/repair/$id.tsx`, `src/routes/technician/job/$id.tsx`, and `src/routes/admin/repair/$id.tsx`.
- **Automated Tests**: 11 tests pass (5 backend contract tests in `diagnostics-contract.test.mjs` + 6 frontend tests in `visual-defect-frontend.test.mjs`).

### Completed in Phase A (Authentication Recovery & RPC Fallback)
- **18 Call Sites Resolved**: Audited and fixed all 18 occurrences of `get_session_profile` across 14 modules.
- **Resilient Fallback**: Every service gracefully catches missing RPC errors / `PGRST202` schema cache misses and queries `public.profiles` using a safe column whitelist (`id, role, full_name, phone, village`).
- **Zero Remote DB Mutations**: Un-migrated and production environments function safely without requiring remote DDL/DML.
- **Automated Tests**: 10 compatibility and simulation tests pass in `tests/auth-production-compatibility.test.mjs`.

### Completed in Phase 12 (Multilingual Farmer Experience)
- **Trilingual Dictionaries (`src/lib/i18n/dictionaries/`)**: Complete key parity across `en.ts`, `hi.ts`, and `mr.ts` with 208 keys each, verified Devanagari script presence, and strict Free-Tier zero external cost compliance.
- **Farmer Portal Localisation**: Localised routes `/farmer`, `/farmer/report-breakdown`, `/farmer/equipment`, `/farmer/equipment/$id`, and `/farmer/repair/$id`.
- **Identity & Name Preservation**: Dynamic user names, tractor makes/models, job numbers, phone numbers, and dates remain untransliterated and uncorrupted.
- **Navigation Language Selector (`src/components/farmer-language-selector.tsx`)**: Single placement in the Farmer Portal top navigation bar. Clean segmented control displaying `EN` / `हिं` / `म` without Lucide globe icon, accessible ARIA attributes, and `localStorage` persistence (`terrabyte_farmer_lang`). Duplicate dashboard selector eliminated.
- **Typography & Responsive Resilience**: Integrated `Noto Sans Devanagari` font stack. Verified across 5 viewports (320px, 375px, 768px, 1024px, 1440px) with 0px horizontal overflow across all three languages.
- **Canonical Speech-to-Text Invariant**: Groq Whisper Large V3 service maintains automatic multilingual detection without forced language constraints. Voice transcripts appended raw to issue descriptions without machine overwriting.
- **Staging Reset Demo Authorization & Verification**: Applied `20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql` to staging (`ubqgvhcfmrvnmrbllcom`), pairing staging demo accounts (`*.staging@terrabyte.app`) with auth UUIDs. Verified single destructive execution restoring baseline fixtures: 3 equipment, 5 depot parts, 0 active repairs. Non-destructive regression check verified.
- **Automated Tests**: 11 Phase 12 tests pass (6 key parity & integrity tests, 5 UI placement/rendering/invariant tests) within the 171-test automated suite.

### Phase 11 & Phase 12 Architectural Invariants
- **Consent Authorization**: **Fail-Closed**. Without explicit boolean `true` opt-in from the owning farmer, AI visual analysis is never executed. If consent is revoked in-flight, analysis is aborted and discarded.
- **Breakdown Submission**: **Fail-Open**. Gemini diagnostic failure, missing API key, timeout, or quota exhaustion must **never** block breakdown ticket creation. The breakdown proceeds with standard triage.
- **Assistive Non-Authority**: AI visual diagnostics provide decision support only. AI suggestions never commit repair status, parts orders, or quotations.

---

## 6. Approved Product-Level Architectural Decisions

> [!NOTE]
> **Product Direction Approved — Implementation Pending**: The 8 decisions below represent approved product-level architectural requirements. Their database schemas, migrations, RPCs, and code implementation are planned for Phases 13–15 and have **not** yet been executed or approved for implementation.

1. **Technician Location = Registered Workshop Base**: Technicians register their physical workshop location (address + verified GPS coordinates). No continuous live GPS tracking. Registered workshop coordinates serve as the routing origin.
2. **Offline Physical KYC at Nagpur Service Centre**: In-person verification at Nagpur Service Centre (MIDC Hingna Road). Admin inspects original credentials and logs safe metadata (document type, masked last-4 ID, notes, timestamp). **Zero online Aadhaar uploads; zero full Aadhaar storage**.
3. **Independent Facility Architecture**: Workshops are independent `repair_facilities` owned by a facility principal. Technicians associate via `facility_memberships` (`OWNER`, `MANAGER`, `TECHNICIAN`). A technician does not automatically become an administrator. Drop-off capability is gated by Service Centre admin approval.
4. **Physical Workshop Bay Capacity**: Workshops configure `max_equipment_capacity`. Tracks physical machinery occupancy, not remote field jobs. Atomic check-in and collection release. Capacity downsizes pause new check-ins without crashing.
5. **Mandatory Doorstep Service for Immobile Equipment**: If machine is completely stopped/immobile (`is_immobile = true`), service is locked to `DOORSTEP`. Workshop Drop-off is disabled. Towing and flatbed recovery are excluded from current scope.
6. **OSRM Road Routing Only**: In-app road distance and estimated driving duration computed via OSRM. **Zero Haversine/crow-flies distance in UI**. If OSRM fails, display `"Road Distance Temporarily Unavailable"`. Never fabricate ETAs or use outages to reject technicians. Google Maps navigation links use verified coordinates.
7. **Verified Completed Repair Ratings**: Reviews restricted strictly to farmers with a completed `service_history` record. 1 review per repair. Unrated technicians display `"New / Unrated"`, never a fabricated 5.00 default.
8. **Farmer-Facing Trilingual Interface**: Farmer Portal localized in English, Hindi, and Marathi (`en` | `hi` | `mr`) using Noto Sans Devanagari typography. Technician and Admin portals remain English. Voice transcription continues preserving Hindi, Marathi, and English independently.

---

## 7. Open Architecture Decisions (`Status: Needs Decision`)

The following 19 architectural questions remain open for review and discussion before their respective future phases:

1. `Needs Decision`: Enforcement mechanism preventing divergence between `repair_facilities.owner_profile_id` and the `OWNER` membership row in `facility_memberships`.
2. `Needs Decision`: Exact permission matrix separating `OWNER` (address, capacity, shop deletion) from `MANAGER` (daily bay intake, mechanic assignments).
3. `Needs Decision`: UI controls and validation in the admin KYC console to capture document type and masked last-4 ID safely.
4. `Needs Decision`: Comprehensive audit of `SECURITY DEFINER` functions, search paths (`search_path = 'public', 'pg_temp'`), and explicit execution grants.
5. `Needs Decision`: Safeguards ensuring facility governance triggers cannot be bypassed if role resolution returns `NULL` or circumvents PostgREST context.
6. `Needs Decision`: Mechanism for binding `repair_requests.facility_id` when the farmer selects an approved workshop prior to physical equipment arrival.
7. `Needs Decision`: Validation rules in `execute_workshop_checkin` ensuring tickets strictly match `WORKSHOP_DROPOFF` mode and `AWAITING_ARRIVAL` status.
8. `Needs Decision`: Verification requirements for farmer collection (touch-canvas signature, SMS OTP, or both).
9. `Needs Decision`: Safeguards ensuring collection cannot mark a ticket `COMPLETED` unless testing has passed and `service_history` is generated.
10. `Needs Decision`: Reliable capacity invariant enforcement when an owner reduces capacity below current occupancy.
11. `Needs Decision`: Private Supabase Storage bucket RLS policies for intake walkaround photos, check-in receipts, and handover signatures.
12. `Needs Decision`: Pre-arrival cancellation authorization rules allowing farmers or admins to cancel a drop-off ticket without consuming capacity or creating receipts.
13. `Needs Decision`: Policy on whether workshops should receive a separate facility rating in addition to technician ratings.
14. `Needs Decision`: Design of `primary_facility_id` on `technician_profiles` (preferred base vs dynamically derived from active memberships).
15. `Needs Decision`: Verification of physical street addresses and GPS coordinates for Central Nagpur Agro Depot (MIDC Hingna) prior to seeding.
16. `Needs Decision`: Complete elimination of hardcoded demo user UUIDs from production migration DDL routines.
17. `Needs Decision`: Review of Hindi terminology with native agricultural speakers to ensure natural rural phrasing.
18. `Needs Decision`: UI copy standards documenting that OSRM driving duration is an estimated road duration without real-time traffic conditions.
19. `Needs Decision`: Maximum duration upper-bound cap for workshop bay reservation extensions in `renew_workshop_bay_reservation` (decision intentionally deferred per user direction; operational risks of long bay holding in Vidarbha sowing/harvest windows evaluated against candidate bounds of 48h/72h).

---

## 8. Deferred Post-Hackathon Scope

The following capabilities are explicitly deferred to post-hackathon commercial iterations:
- Integrated UPI / Razorpay payment gateway & escrow settlements.
- WhatsApp Meta Cloud API / SMS telephony bots (Twilio / Gupshup).
- Tractor CAN-bus J1939 telematics & OBD hardware dongles.
- Flatbed towing and transport recovery dispatch.
- Multi-depot cooperative and FPO federated networks.
- External distributor ERP inventory integrations (Mahindra Parts Smart, John Deere Parts Network).
- Online / automated digital KYC verification.
