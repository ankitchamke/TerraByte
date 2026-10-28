# TerraByte — Project State

## 1. Current Phase & Engineering Status

- **Status**: **FROZEN / SUBMISSION READY — NAGPUR RISE 2026 STAGE 1**
- **Branch**: `main` (Connected to Lovable; no destructive Git history operations)
- **Official Problem Statement**: **"One-Stop Agricultural Equipment Repair"**
- **Domain**: AgriTech · Agricultural Machinery Maintenance & Operational Coordination
- **Lifecycle Milestone Summary**:
  - **Phase 1 — Codebase Cleanup & Documentation Reset**: **COMPLETE**
  - **Phase 2 — Domain Database Foundation & Security Hardening**: **COMPLETE**
  - **Phase 3 — Core Repair & Quotation Workflows**: **COMPLETE**
  - **Phase 4 — Operational Experience & Notifications**: **COMPLETE**
  - **Phase 5 — Product Polish, Demo Reset, Communication & Completion**: **COMPLETE** (Phases 5.1 through 5.6)
  - **Phase 6 — Production Readiness & Account Hardening**: **COMPLETE** (Commit `27a1e69`)
  - **Phase 7 — Realtime Synchronization Foundation & Concurrency Hardening**: **COMPLETE** (Commit `91b7c83` + working tree)
  - **Phase 8 — Stabilization and Deployment Operations**: **IN PROGRESS** (Phase 8A committed on branch `phase-8`; automated smoke tests passing; live Vercel environment verification pending)
- **Feature Development Status**: Original Phases 1–7 preserved. Phase 8 stabilization underway on branch `phase-8`. Phase 9 planned upon Phase 8 finalization.

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

### Phase 8 — Stabilization and Deployment Operations (In Progress — Phase 8A Committed on branch `phase-8`)
- **Repository Baseline Protection**: Restored exact HEAD versions of `.env.example` and `AGENTS.md` on branch `phase-8`.
- **Health Endpoint Security Hardening (Phase 8A)**:
  - Reused generated helper `authenticateCronRequest` (`src/integrations/supabase/cron-auth.ts`) to enforce timing-safe Bearer secret authentication before any client creation or database query; accepts `CRON_SECRET` or `TERRABYTE_CRON_SECRET` (with previous-secret rotation aliases).
  - Returns HTTP 500 plain text (`"Server configuration error"`) if all current-secret aliases are unset; rejects missing, malformed, or query-string credentials (`?secret=` / `?token=`) with HTTP 401 plain text (`"Unauthorized"`) without probing the database (when a current secret is configured).
  - Returns a minimal sanitized payload (`{ status: "healthy" | "unhealthy", timestamp, checks: { database: "operational" | "error" }, message?: string }`) without exposing raw database error strings in responses or server logs.
- **Low-Privilege Supabase Health Probe**:
  - Probes database strictly via verified public keys (`sb_publishable_...` or legacy JWT with decoded `role: "anon"`); explicitly rejects `sb_secret_`, non-anon roles (such as `service_role`), and unverified key formats even if configured under publishable-named environment variables. Never reads or logs service-role credentials.
  - Implemented `createSupabaseFetch` wrapper consistent with `auth-middleware.ts` and `client.ts` for clean publishable key header management.
  - Probes `profiles.id` with `limit(1)`; live `anon` table SELECT permission remains unconfirmed in migrations and is pending owner verification.
- **Liveness vs Readiness Separation**:
  - `HEAD /api/health` returns HTTP 200 lightweight liveness indicator without querying Supabase or requiring bearer auth. Documented as liveness-only.
- **Unified Scheduled Monitoring**:
  - Retained Vercel Cron (`vercel.json`) at `0 5 * * 1,3,5` as the sole scheduled health check.
  - Omitted untracked GitHub Actions workflow, eliminating credential exposure risk and redundant triggers.
- **Verification Status**:
  - `npx tsc --noEmit`: PASS (0 errors).
  - Targeted ESLint: PASS (0 errors).
  - `npm run build`: PASS (clean Nitro Vercel output).
  - Out-of-tree scratch smoke check: Verified 6 security scenarios via temporary local node script; repository manual QA pending.
  - Live deployment verification: PENDING project owner verification of Vercel production environment variables.

### Phase 8B — Doorstep & Mobile Repair (In Progress — Phase 8B.1 Migration Applied & Verified)
- **Phase 8B.1 — Service Location Intake, Optional GPS & Technician Directions**:
  - Implemented coarse location intake on `/farmer/report-breakdown`: farmer enters village name and selects from official 14 Nagpur District Tahsils (`src/lib/location.ts`).
  - Village is prefilled from farmer profile if available; tahsil is never inferred.
  - Optional one-time browser GPS capture (`navigator.geolocation.getCurrentPosition`) with permission handling, accuracy tracking, error/retry feedback, and in-memory isolation (never stored in `localStorage` drafts, URLs, or logs).
  - Migration `20261027100000_phase8b_1_dispatch_locations.sql` applied to development project `hwdrypkvszwrcraujctw` and recorded in `supabase_migrations.schema_migrations`: creates table `public.repair_dispatch_locations`, grants, and 4 subquery RLS policies.
  - PostgREST API schema resolution verified: read query returns HTTP 200 OK (resolving prior `PGRST205` error).
  - Multi-step mutation compensation: `createRepairRequest` invokes authorized `cancelRepairRequest` on failed dispatch location writes to guarantee state-machine and equipment consistency.
  - Directions to service location via Google Maps universal navigation link with explicit external disclosure dialog (`rel="noopener noreferrer"`, `target="_blank"`), plus fallback area search when GPS is absent.
  - Differentiated 3-state GPS visibility UI: (a) tickets created without GPS (coarse search fallback), (b) tickets with exact GPS captured and viewer authorized, (c) private coordinates restricted to assigned technician/farmer/admin (open queue sees coarse location only).
  - Server-mediated in-app driving distance & ETA estimation via Google Maps Routes API v2 (`TRAFFIC_UNAWARE`, transient calculation, server-side-only API key, explicit pre-action disclosure).
  - Resilient ticket ID resolution: `getRepairDispatchLocation` and `/api/route-estimate` handle both UUIDs and human-readable job numbers (e.g. `TB-7524`), eliminating route param lookup failures.
  - Rendered on Farmer repair detail (`/farmer/repair/$id`), Technician job detail (`/technician/job/$id`), and Admin repair detail (`/admin/repair/$id`).
  - Address autofill, reverse geocoding, and demo-data modifications remain deferred.
  - Verification: 0 TypeScript errors (`npx tsc --noEmit`), clean Vite/Nitro production build (`npm run build`), clean lint, and 17 automated tests passing (`tests/route-estimate.test.mjs`). Status: **IN PROGRESS (Awaiting owner manual QA)**.

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
| **Service History** | Permanent equipment maintenance records, downtime hours, invoices | Blockchain NFT maintenance ledger |
| **Data Hygiene & Demo** | Atomic dual-key `reset_demo_data()` RPC, real user isolation, Nagpur geography | Multi-district cluster tenancy |

---

## 4. Locked Engineering Decisions

1. **Regional Anchor**: Anchored strictly in **Nagpur District, Maharashtra** (Vidarbha region: Katol, Saoner, Umred talukas; cotton, soybean, orange farming contexts).
2. **Database as Source of Truth**: Live Supabase PostgreSQL is the sole source of truth. Mock store fixtures (`tb-store.ts`) serve solely as fallback reference definitions.
3. **Data Scoping Discipline**: Every data query must resolve caller identity through authenticated `auth.uid()` $\rightarrow$ `profiles` row $\rightarrow$ `profile.id`, strictly scoped to the authenticated user.
4. **Demo Account Authorization**: Reset Demo capabilities are strictly restricted on the backend via dual-key authorization to the 5 designated evaluation personas:
   - `farmer.nagpur@terrabyte.demo`
   - `farmer2.nagpur@terrabyte.demo`
   - `farmer3.nagpur@terrabyte.demo`
   - `tech.nagpur@terrabyte.demo`
   - `admin.nagpur@terrabyte.demo`
5. **Real User Isolation**: Real user data is strictly isolated by RLS and cannot be modified or cleared by demo reset operations.
6. **Assistive AI Boundary**: Machine diagnostics use rule-based reasoning with transparent markers. AI provides decision support; farmers and technicians retain final operational authority.
7. **Submission Freeze Rule**: Zero new feature initiatives or architecture refactors are permitted during the Nagpur RISE 2026 Stage 1 evaluation period.
