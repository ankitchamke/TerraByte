# TerraByte — Master Project State

## 1. Project Reference & System Overview

- **Project**: TerraByte — Agricultural Equipment Repair Coordination Ecosystem
- **Anchor Region**: Nagpur District & Vidarbha Agrarian Heartland, Maharashtra (Katol, Saoner, Umred, Hingna)
- **Core Mission**: Dramatically compress the time between agricultural machinery breakdown and getting back to work in the field.
- **Technology Stack**: React 19 SPA + TanStack Start / Router + Vite 8 + Nitro (`vercel` preset) + Supabase (Auth, PostgreSQL 17, Storage, Realtime) + Google Gemini API (Visual Diagnostics).
- **Free-Tier Constraint**: 100% Free-Tier compatible ($0.00 spend). Zero paid fallback services, zero automatic billing upgrades, and zero unexpected charges.

---

## 2. Current Position & Milestone Status

- **Current Phase**: **Phase 11 of 16 — Gemini AI Visual Diagnostics (IN PROGRESS — MIDWAY)**
- **Branch**: `phase-11` (Connected to Lovable; strictly additive Git history, no force-pushing/rebasing)
- **Status Summary**:
  - Phases 1–10: **COMPLETED & VERIFIED**
  - Phase 11: **IN PROGRESS (MIDWAY)** — Backend RPCs, Zod schema contracts, API route, and server-side Gemini service are complete; frontend intake consent UI, dead video handler cleanup, and diagnostic display card are active.
  - Phases 12–16: **PLANNED** (Future phases; not yet implemented)
  - Post-Hackathon: **DEFERRED** (Payments, WhatsApp bot, OEM telematics, FPO networks, towing/flatbed recovery, external ERP inventory)

```text
Progress: [██████████████░░░░░░] 68% (Phase 11 Midway of 16-Phase Roadmap)
```

---

## 3. Verified Empirical Test & Build Health

The following figures were verified live via empirical command execution on **2026-11-04**:

- **Automated Test Suite (`npm test`)**:
  - Total Tests: **144**
  - Passing Tests: **144** (0 failures, 0 skipped, 0 cancelled)
  - Execution Duration: **1.23s**
  - Test Suites Covered: 6 suites (`demo-accounts`, `diagnostics-contract`, `parts-desk`, `profile-security-architecture`, `route-estimate`, `safe-scoped-reset`)
- **Production Build (`npm run build`)**:
  - Status: **SUCCESS**
  - Compiler: Vite 8.1.5 + Nitro (preset: `vercel`)
  - Build Duration: **1.15s SSR / 2.51s client**
  - Output Target: `.vercel/output` (Serverless bundle)

---

## 4. Phase-by-Phase Roadmap Status (Phases 1–16)

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
| **Phase 11** | Gemini AI Visual Diagnostics | **IN PROGRESS (MIDWAY)** | Backend migration `20261103120000`, Zod schemas, API endpoint `/api/assess-visual-defect`, and Gemini 3.5 Flash-Lite service complete (5 contract tests pass). **Remaining**: Intake consent UI, dead video handler cleanup, and `<VisualDiagnosticsCard />`. |
| **Phase 12** | Hindi Regional Experience (Farmer-Facing) | **PLANNED** | Farmer-facing English + Hindi (`en` | `hi`) interface, Noto Sans Devanagari typography, zero Marathi in UI (Whisper voice transcription independent). |
| **Phase 13** | Technician Trust, Physical KYC & Workshops | **PLANNED** | In-person physical KYC at Nagpur Service Centre (zero Aadhaar storage), independent `repair_facilities`, multi-tech memberships, verified ratings (no default 5.0), touch-canvas handover pad. |
| **Phase 14** | Smart Dispatch & Workshop Drop-Off | **PLANNED** | Mandatory Doorstep for immobile machinery, OSRM road distance from workshop GPS, Google Maps navigation links, Workshop Drop-Off workflow, atomic bay capacity check, Harvest SOS priority pinning. |
| **Phase 15** | Preventive Maintenance Intelligence | **PLANNED** | Machinery operating-hour alerts (50h, 250h, 500h, 1000h intervals), Vidarbha seasonal crop advisory calendar, 1-click maintenance package booking. |
| **Phase 16** | System-Wide QA & Release Readiness | **PLANNED** | Master stabilization gate, full regression run, multi-role staging rehearsal, zero critical/high severity bugs sign-off. |

---

## 5. Active Phase 11 Detailed Status & Boundaries

### Completed in Phase 11
- **Database Layer**: `supabase/migrations/20261103120000_phase11_visual_defect_diagnostics.sql` (implements atomic claim token `claim_repair_visual_diagnostic`, fail-closed consent state machine `grant_repair_visual_consent` / `revoke_repair_visual_consent`, service-role finalizer `save_repair_visual_diagnostic`, and sanitized failure recorder `finalize_repair_visual_diagnostic_failure`).
- **Server Service Layer**: `src/lib/services/gemini-diagnostic.ts` (photo bounding to 4 MB / max 4 photos, prompt with Nagpur depot parts catalog context, Gemini 3.5 Flash-Lite REST execution, timeout abort controller, 750ms in-flight consent cancellation poller).
- **API Endpoint**: `src/routes/api/assess-visual-defect.ts` (Bearer auth validation, profile resolution, claim verification).
- **Zod Contracts**: `src/lib/types/visual-diagnostics.ts` (`VisualDiagnosticResponseSchema`, error codes, payload limits).
- **Unit Tests**: 5 contract tests passing in `tests/diagnostics-contract.test.mjs`.

### Remaining Work to Complete Phase 11
1. **Consent UI**: Add explicit farmer opt-in checkbox and legal disclaimer to `src/routes/farmer/report-breakdown.tsx`.
2. **Dead Video Handler Removal**: Remove `video/*` accept filter and dead video toast in `report-breakdown.tsx`; restrict strictly to compressed photos.
3. **Client API Mutation**: Connect breakdown submission to call POST `/api/assess-visual-defect`.
4. **Diagnostic Results Card**: Build `<VisualDiagnosticsCard />` in `src/routes/farmer/repair/$id.tsx` and `src/routes/admin/repair/$id.tsx`.
5. **Fail-Open Verification**: Ensure breakdown creation succeeds even if `GEMINI_API_KEY` is missing, times out, or returns 429 quota exhaustion.

### Phase 11 Architectural Invariants
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
8. **Farmer-Facing English + Hindi Interface**: Interface localized in English and Devanagari Hindi using Noto Sans Devanagari typography. Zero Marathi in application UI. Voice transcription continues supporting Hindi, Marathi, and English independently.

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
