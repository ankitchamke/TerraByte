# TerraByte — Testing Strategy & Verification Matrix

## 1. Testing Philosophy & Continuous Quality Assurance

TerraByte adheres to a strict test-driven development and continuous backpressure model:
- **Zero Test Cheating**: Existing test suites and assertions are never deleted, commented out, or weakened to force a passing build. Application code must be genuinely corrected.
- **Continuous Automated Verification (Phases 11–15 $\rightarrow$ Phase 16)**: Every phase must maintain continuous automated testing. Testing is never postponed to Phase 16 alone; Phase 16 serves as the final system-wide release gate and end-to-end certification.
- **Empirically Verified Baseline**: Test results recorded as current must reflect live executed commands. All figures in this document are confirmed via live execution.

---

## 2. Live Verified Baseline (Empirical Evidence)

The following baseline metrics were verified via live command execution on the `phase-11` branch:

- **Automated Test Suite**:
  - Command: `npm test`
  - Output: **144 passing tests across 6 test suites in 1.23s** (0 failed, 0 skipped, 0 flaky) — *verified on 2026-11-04*.
- **Production Bundle & Build Time**:
  - Command: `npm run build`
  - Output: **Successfully built in 1.15s SSR / 2.51s client** (TanStack Start + Vite 8.1.5 + Nitro `vercel` serverless preset, 0 errors, 0 warnings) — *verified on 2026-11-04*.
  - Status: Zero TypeScript errors, zero bundle syntax errors, zero dead code warnings.

### Active Test Suites Inventory

| Suite File | Scope / Domain Covered | Passing Tests | Execution Time |
| :--- | :--- | :---: | :---: |
| `tests/parts-desk.test.mjs` | Central depot catalog, requisitions, stock movements, sales history, atomic handoffs (`FOR UPDATE`), role privacy | 105 tests | ~720ms |
| `tests/route-estimate.test.mjs` | OSRM road distance, driving duration, Nagpur tahsil mapping, GPS accuracy, timing-safe Bearer health check | 21 tests | ~180ms |
| `tests/profile-security-architecture.test.mjs` | Decoupled profiles, `profile_auth_secrets` isolation, parameterless `get_session_profile()` RPC, RLS access controls | 28 tests | ~240ms |
| `tests/diagnostics-contract.test.mjs` | Phase 11 Gemini contract: unauthenticated 401, photo size boundary ($\le 4\text{ MB}$), claim verification, Zod schema | 5 tests | ~85ms |

*(Total active verified tests: 144 tests passing).*

---

## 3. Quick Evaluator & Hackathon Demo Walkthrough (5-Minute Interactive Demo)

All demo accounts use password: `terrabyte2026`. On `/login`, users can click the Quick Demo buttons or manually enter credentials:

| Persona | Login Email | Location | Pre-Configured Seeded Scenario |
| :--- | :--- | :--- | :--- |
| **Farmer 1** (Balasaheb Patil) | `farmer.nagpur@terrabyte.demo` | Katol, Nagpur | `TB-8841` (Mahindra 575 DI) — Paused on `WAITING_FOR_PARTS` (Bosch injector nozzle). |
| **Farmer 2** (Suresh Jadhav) | `farmer2.nagpur@terrabyte.demo` | Saoner, Nagpur | `TB-8902` (John Deere 5050D) — `QUOTE_PENDING` (Itemized quote ready for approval). |
| **Farmer 3** (Anil Pawar) | `farmer3.nagpur@terrabyte.demo` | Umred, Nagpur | `TB-8898` (Swaraj 744 FE) — Newly `REQUESTED` breakdown (Unassigned). |
| **Technician** (Ramesh Kumar) | `tech.nagpur@terrabyte.demo` | Nagpur Mobile Repairs | Active assigned jobs, quote builder, parts pickup card, load testing sign-off. |
| **Service Centre** (Admin) | `admin.nagpur@terrabyte.demo` | Nagpur Central Command | District dispatch board, cancellation review workbench, parts desk (`/admin/parts-desk`). |

### 5-Step Evaluator Script:
1. **Farmer View (`/farmer`)**:
   - Inspect `TB-8841` on `WAITING_FOR_PARTS` hold: see missing part details (*Bosch injector nozzle*) and revised sourcing ETA.
   - Inspect `TB-4489` with `<QuoteComparison />`: side-by-side Quote v1 vs v2 diffing with line-item breakdown.
   - Chat in `<RepairChat />`: send a message and observe instant real-time delivery.
2. **Technician Workbench (`/technician`)**:
   - Open job `TB-8841`: click **"Resume repair"** $\rightarrow$ transitions to `IN_PROGRESS`.
   - Click **"Start testing"** $\rightarrow$ transitions to `IN_PROGRESS (Testing)` indicating mechanical fix complete and load testing underway.
   - Click **"Complete & sign off"**: enter notes $\rightarrow$ auto-generates permanent `service_history` (`INV-TB-xxxx`), restores equipment to `Operational`, and notifies farmer and admin.
3. **Parts Desk Administration (`/admin/parts-desk`)**:
   - Inspect Nagpur central depot inventory across tractor brands (Mahindra, John Deere, Swaraj).
   - Review pending requisitions and click **"Confirm Handoff"** to execute atomic row-locked stock decrement.
4. **Operations Dispatch Board (`/admin`)**:
   - View active repairs filtered by Nagpur tahsils.
   - Click **"Completed"** and **"Cancelled"** tabs: verify closed records are isolated from active operational triage.
5. **Deterministic Demo Reset**:
   - Click the **Reset Demo** icon (`RotateCcw`) in the shell header.
   - RPC `reset_demo_data()` restores all canonical baseline fixtures in $< 500\text{ ms}$, leaving real user records untouched.

---

## 4. Phase-by-Phase Continuous Testing Requirements (Phases 11–15)

To guarantee continuous quality, every phase must implement automated tests satisfying these exact verification gates before being marked complete:

### Phase 11: Visual Defect Diagnostics (Google Gemini AI)
- **TEST-11-01 (Contract Verification)**: Unauthenticated requests to `/api/assess-visual-defect` rejected with HTTP 401. *(PASS)*
- **TEST-11-02 (Payload Boundary)**: Images exceeding 4 MB or invalid Base64 rejected with HTTP 400. *(PASS)*
- **TEST-11-03 (Token Security)**: Ephemeral claim tokens verified atomically via `verify_diagnostic_claim_token()`; replay attacks rejected. *(PASS)*
- **TEST-11-04 (Schema Conformity)**: Structured JSON output strictly validates against `VisualDiagnosticResponseSchema`. *(PASS)*
- **TEST-11-05 (Fail-Closed Consent Authorization)**: Frontend unit test verifying that unchecking the AI consent box prevents photo transmission to Gemini. *(To be implemented)*
- **TEST-11-06 (Fail-Open Breakdown Submission)**: Integration test simulating Gemini API timeout / HTTP 429; ticket creation must succeed with fallback rule-based diagnostic card. *(To be implemented)*
- **TEST-11-07 (Dead Media Cleanup)**: Unit test verifying that only photo files are accepted and processed in breakdown intake. *(To be implemented)*

### Phase 12: Multilingual Experience (English + Hindi Farmer UI)
- **TEST-12-01 (Dictionary Completeness)**: Automated key parity test verifying 100% of translation keys in `en` dictionary exist in `hi` dictionary.
- **TEST-12-02 (Devanagari Font Rendering)**: UI visual regression test ensuring Hindi conjuncts and ligatures render properly using Noto Sans Devanagari.
- **TEST-12-03 (Responsive Layout & Text Expansion)**: Viewport test (320px–375px) ensuring Hindi text length expansion causes zero horizontal overflow, button clipping, or card misalignment.
- **TEST-12-04 (Marathi Voice Transcription Preservation)**: Speech-to-text test ensuring Marathi audio input correctly populates the problem description via Whisper / Web Speech API.

### Phase 13: Technician Trust, Shared Workshops & Accountability
- **TEST-13-01 (Shared Facility RLS)**: Access control tests verifying workshop owners can edit their facility profile, while member technicians in `facility_memberships` (`OWNER`, `MANAGER`, `TECHNICIAN`) have role-appropriate access.
- **TEST-13-02 (Drop-Off Gate Privilege)**: Security test verifying that non-admin users cannot alter `drop_off_approved` on `repair_facilities`.
- **TEST-13-03 (Physical In-Person KYC Security)**: Security test ensuring `verify_technician_kyc()` RPC is callable only by `service_centre` role; verifies zero Aadhaar documents or full numbers are stored.
- **TEST-13-04 (Admin Gate for AI Expertise)**: Test verifying AI-suggested brand and skill tags remain hidden from public technician profiles until explicitly approved by Service Centre admin.
- **TEST-13-05 (Verified-Only Rating Gate)**: RLS test ensuring farmers without a completed `service_history` record are blocked from inserting `technician_reviews`.
- **TEST-13-06 (Null Default Rating Integrity)**: Calculation test verifying technicians with 0 reviews return `rating = NULL` and render *"New / Unrated"*, without pulling down or falsely inflating average calculations.
- **TEST-13-07 (Review Recalculation Trigger)**: Database trigger test verifying average rating and total review count recalculate accurately on review INSERT, UPDATE, and DELETE.

### Phase 14: Smart Dispatch & Emergency Response
- **TEST-14-01 (Workshop-Based Routing)**: Unit test verifying technician travel distance and duration calculate from the technician's registered workshop coordinates (`repair_facilities.latitude/longitude`) with no continuous live GPS tracking.
- **TEST-14-02 (Strict Haversine Ban)**: Assertion test verifying that straight-line Haversine distance is never emitted in API responses or rendered in UI matching cards.
- **TEST-14-03 (OSRM Outage Graceful Fallback)**: Test simulating OSRM downtime / network failure; UI must render *"Road Distance Temporarily Unavailable"* and must not crash or disqualify technicians.
- **TEST-14-04 (Immobile Machine Gate)**: State machine test verifying that `is_immobile = true` disables the Workshop Drop-Off radio button and locks service to Doorstep only.
- **TEST-14-05 (Workshop Bay Capacity)**: Concurrency test ensuring workshops where `active_repairs >= max_equipment_capacity` are rejected from receiving new drop-off allocations.

### Phase 15: Preventive Maintenance Intelligence & Offline Field Reliability
- **TEST-15-01 (Vidarbha Agro-Climatic Rules)**: Heuristics test verifying seasonal trigger generation (Pre-Kharif fluid check in May, Pre-Rabi harvester check in October).
- **TEST-15-02 (Offline Service Worker Caching)**: Test simulating network disconnection; active job cards and machine logbooks must remain readable offline.
- **TEST-15-03 (Optimistic Mutation Sync)**: Offline queue test verifying technician status updates queue in IndexedDB and replay idempotently upon reconnection.

---

## 5. Phase 16: Master Release Gate & Verification Criteria

Before final production release and deployment sign-off, the application must pass this comprehensive release gate:

### 5.1 Multi-Role End-to-End Regression Matrix
1. **Scenario 1: Complete On-Field Repair Lifecycle**:
   - Farmer reports breakdown $\rightarrow$ Gemini AI visual assessment $\rightarrow$ OSRM workshop dispatch $\rightarrow$ Technician accepts $\rightarrow$ Itemized quote submitted & approved $\rightarrow$ Parts requisition & handoff from depot $\rightarrow$ Field repair & load testing sign-off $\rightarrow$ Permanent `service_history` committed $\rightarrow$ Farmer verified review.
2. **Scenario 2: Immobile Machine On-Field Emergency**:
   - Machine marked immobile $\rightarrow$ Workshop drop-off blocked $\rightarrow$ Urgent field dispatch $\rightarrow$ Work completed on site.
3. **Scenario 3: Workshop Drop-Off Flow**:
   - Farmer selects approved workshop $\rightarrow$ Drop-off receipt `RCP-TB-xxxx` generated $\rightarrow$ Capacity incremented $\rightarrow$ Repair completed $\rightarrow$ Equipment collection authorization verified.
4. **Scenario 4: Governed Cancellation Lifecycle**:
   - Farmer requests cancellation on active repair $\rightarrow$ Technician placed on work-hold $\rightarrow$ Service Centre reviews and approves/declines $\rightarrow$ State transitions cleanly.

### 5.2 Security & Authorization Audit
- [ ] 100% of PostgreSQL tables (20+ tables) covered by strict Row Level Security.
- [ ] Direct client modifications to `public.profiles` blocked; role elevation attempts rejected with exceptions.
- [ ] Zero read access to `public.profile_auth_secrets` for non-owner callers (including administrators).
- [ ] Farmer exact GPS coordinates quarantined to assigned technician and admin dispatchers.
- [ ] Central parts depot wholesale costs and internal notes hidden from farmers.
- [ ] In-person physical KYC verified with zero Aadhaar document uploads or full number storage.

### 5.3 Performance & Build Verification
- [ ] Production build (`npm run build`) completes in $< 2.0\text{ seconds}$ with zero errors.
- [ ] Serverless bundle size optimized for instant cold-start execution on Nitro / Vercel.
- [ ] 100% of tests passing in `npm test` with zero failed or skipped tests.
- [ ] Zero unhandled promise rejections, zero React hydration errors, zero console errors across all three operational portals.

---

*Testing document updated: 2026-11-04 — Synchronized with Master Project Architecture & Approved Decisions*