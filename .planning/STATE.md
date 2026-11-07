# TerraByte — Master Project State

## 1. Project Reference & System Overview

- **Project**: TerraByte — Agricultural Equipment Repair Coordination Ecosystem
- **Anchor Region**: Nagpur District & Vidarbha Agrarian Heartland, Maharashtra (Katol, Saoner, Umred, Hingna)
- **Core Mission**: Dramatically compress the time between agricultural machinery breakdown and getting back to work in the field.
- **Technology Stack**: React 19 SPA + TanStack Start / Router + Vite 8 + Nitro (`vercel` preset) + Supabase (Auth, PostgreSQL 17, Storage, Realtime) + Google Gemini API (Visual Diagnostics).
- **Free-Tier Constraint**: 100% Free-Tier compatible ($0.00 spend). Zero paid fallback services, zero automatic billing upgrades, and zero unexpected charges.

---

## 2. Current Position & Milestone Status

- **Current Phase**: **Phase 13 — Technician Trust, Shared Workshops & Accountability (INITIALIZED & PLANNING READY)**
- **Branch**: `phase-13` (Created from completed `phase-12` base commit `7996ccc`; strictly additive Git history, no force-pushing/rebasing)
- **Status Summary**:
  - Phases 1–10: **COMPLETED & VERIFIED**
  - Phase A (Auth Recovery): **COMPLETED & VERIFIED** — Resolved all 18 `get_session_profile` call sites across 14 modules with safe column fallback (`profiles.id, role, full_name, phone, village`), zero DB modifications, and verified mock client recovery.
  - Phase 11 (Visual Diagnostics): **COMPLETED & VERIFIED ON STAGING** — Dedicated Supabase staging (`ubqgvhcfmrvnmrbllcom`), 18 tables, 49 RLS policies, synthetic seed fixtures, interactive `DefectAnnotationCanvas`, multi-portal `VisualDefectDiagnosticViewer`, fail-closed consent opt-in, fail-open breakdown submission, live catalogue tractor compatibility matching, and staff force rescan lifecycle verified end-to-end. Production (`hwdrypkvszwrcraujctw`) strictly air-gapped and untouched.
  - Phase 12 (Multilingual Experience): **COMPLETED & VERIFIED ON STAGING** — Trilingual Farmer Portal (English, Hindi, Marathi) with 100% dictionary key parity (208 keys), Noto Sans Devanagari typography, compact top-nav segmented selector (`EN` / `हिं` / `म`), canonical Groq Whisper Large V3 voice transcription preservation, responsive 320px–1440px overflow immunity, and verified staging Reset Demo RPC paired authorization.
  - Phase 13: **IN PROGRESS — MILESTONES 1, 2, 3 & 4 COMPLETE** (Technician Trust, Shared Workshops & Verified Reviews: M1 Database Foundations committed `80537c6`, M2 Shared Workshop Governance committed `e0aeaa0`, M3 Physical KYC committed `45121f5`, M4 Verified Reviews & Technician Ratings verified across 261 tests)
  - Phases 14–17: **PLANNED** (Future phases; not yet implemented)
  - Post-Hackathon: **DEFERRED** (Payments, WhatsApp bot, OEM telematics, FPO networks, towing/flatbed recovery, external ERP inventory)

```text
Progress: [█████████████████░░░] 81% (Phase 13 Milestones 1–4 Complete of 17-Phase Roadmap)
```

---

## 3. Verified Empirical Test & Build Health

The following figures were verified live via empirical command execution on **2026-11-07**:

- **Automated Test Suite (`npm test`)**:
  - Total Tests: **261**
  - Passing Tests: **261** (0 failures, 0 skipped, 0 cancelled)
  - Execution Duration: **2.25s**
  - Test Suites Covered: 14 suites (`auth-production-compatibility`, `cleanup-verification`, `diagnostics-contract`, `i18n-dictionary-parity`, `parts-desk`, `parts-matching`, `profile-security-architecture`, `route-estimate`, `visual-defect-frontend`, `phase-13-db-invariants`, `phase-13-workshop-management`, `phase-13-demo-remediation`, `phase-13-kyc-and-skills`, `phase-13-reviews-and-ratings`)
- **Real-Image Acceptance Suite (`scratch/phase-11/run_real_image_acceptance.mjs`)**:
  - Live Tests: **18/18 PASS** (Genuine tractor engine bay photograph, CC BY 4.0, zero PII, 2.84 MB, farmer consent, live `gemini-3.5-flash-lite` 4324ms, zero defect hallucination, non-authoritative zero spurious parts commitment, multi-portal queries, 30s cooldown enforcement, staff force rescan, audit history archival)
- **Staging & Gemini Acceptance Suite (`scratch/phase-11/run_phase11_acceptance.mjs`)**:
  - Live Tests: **24/24 PASS** (GoTrue auth sessions, fail-closed consent, concurrency locks, live `gemini-3.5-flash-lite` multimodal response, catalogue compatibility filtering, technician force rescan, admin corruption recovery)
- **Phase 12 Responsive Viewport Suite (`scratch/phase-12/test_responsive_viewports.mjs`)**:
  - Viewports: **15/15 PASS** (320x568, 375x667, 768x1024, 1024x768, 1440x900 across English, Hindi, and Marathi with 0px horizontal scroll overflow)
- **TypeScript Compiler (`npx tsc --noEmit`)**:
  - Status: **0 ERRORS** (Clean compilation across all application modules and routes)
- **Production Build (`npm run build`)**:
  - Status: **SUCCESS** (TanStack Start + Vite 8.1.5 + Nitro `vercel` serverless preset, 1.20s build, 0 errors, 0 warnings)
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
| **Phase 13** | Technician Trust, Physical KYC & Workshops | **NEXT — PLANNED** | In-person physical KYC at Nagpur Service Centre (zero Aadhaar storage), independent `repair_facilities`, multi-tech memberships, verified ratings (no default 5.0), touch-canvas handover pad. |
| **Phase 14** | Smart Dispatch & Workshop Drop-Off | **PLANNED** | Mandatory Doorstep for immobile machinery, OSRM road distance from workshop GPS, Google Maps navigation links, Workshop Drop-Off workflow, atomic bay capacity check, Harvest SOS priority pinning. |
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

The following 18 architectural questions remain open for review and discussion before their respective future phases:

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
