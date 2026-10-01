# TerraByte — Project State

## 1. Current Phase

- **Current Phase**: **PHASE 1 — COMPLETE** (Codebase Cleanup + Documentation Reset)
- **Next Phase**: **PHASE 2 — NEXT** (Domain Database + Storage Foundation)
- **Branch**: `phase-2-recovery` (connected to Lovable; no destructive Git history operations)

---

## 2. Current Project Status

TerraByte is an end-to-end digital agricultural equipment repair ecosystem designed to coordinate the complete journey from machinery breakdown to verified repair and back into the field.

Following the application code baseline reset with the fresh Lovable-generated TanStack Start codebase, Phase 0 (Baseline Audit) and Phase 1 (Codebase Cleanup + Documentation Reset) have established a clean, verified engineering foundation.

### Already Working

- **Frontend UI & Styling**: Fully responsive, high-contrast mobile/desktop UI built with React 19, Vite 8, Tailwind CSS 4, and Lucide React icons across all views.
- **Client & Server Routing**: TanStack Router with 14 active routes spanning Farmer, Technician, Service Centre (Admin), Auth, and MCP interfaces.
- **Supabase Authentication**: Native Supabase Auth (`supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`, `supabase.auth.signOut()`, and auto-restored sessions via `onAuthStateChange`).
- **Profile Provisioning**: Automated PostgreSQL trigger (`on_auth_user_created`) on `auth.users` that populates `public.profiles` (and `public.technician_profiles`) immediately on user registration.
- **Role-Based Architecture**: Hardened PostgreSQL `app_role` enum (`'farmer'`, `'technician'`, `'service_centre'`) protected against client tampering via `guard_profile_privileges()` trigger.
- **Technician Verification Gate**: Unverified technicians (`is_verified = false`) are held at `/technician/pending`. Service Centre dispatchers can review credentials and approve or revoke access live via `/admin/technicians`.
- **Row Level Security (RLS)**: Enforced on identity tables (`profiles`, `technician_profiles`), guaranteeing users can only read/edit their own data while `service_centre` staff maintain administrative visibility.
- **Assistive Assessment Engine**: Deterministic preliminary diagnostic rule engine ([`src/lib/assessment.ts`](file:///d:/Projects/TerraByte/src/lib/assessment.ts)) mapping symptoms to likely affected mechanical systems, parts categories, urgency, and safety advice.
- **Technician Matching Engine**: Multi-factor scoring algorithm ([`src/lib/matching.ts`](file:///d:/Projects/TerraByte/src/lib/matching.ts)) ranking technicians by brand specialization, system expertise, current availability, and travel ETA.
- **Model Context Protocol (MCP)**: Server endpoint ([`src/routes/mcp.ts`](file:///d:/Projects/TerraByte/src/routes/mcp.ts)) exposing diagnostic and matching tools (`list_symptoms`, `assess_breakdown`, `match_technicians`) via `@lovable.dev/mcp-js`.

### Not Yet Live

- **Equipment Database**: Machinery fleet data (`equipment` table) is not yet migrated to the new Supabase schema.
- **Repair Incident Database**: Incident lifecycle tickets (`repairs` / `breakdowns`) and timeline audits are not yet live in PostgreSQL.
- **Quote & Parts Database**: Itemized repair quotations (`quotes`, `quote_parts`) and parts-on-hold tracking are not yet live in PostgreSQL.
- **Permanent Service History**: Completed service records bound to machine serial/chassis numbers are not yet live in PostgreSQL.
- **Notifications System**: In-app role-based alerts and broadcast feeds are not yet persisted in PostgreSQL.
- **Business-Domain Storage Buckets**: Supabase Storage buckets for machine photos, breakdown evidence, and repair completion photos with RLS are not yet created.
- **Live Domain Workflow**: UI pages still read from and write to the local simulated store rather than executing live Supabase mutations.

### Current Limitation

- **Local Store Execution**: While authentication, user registration, role resolution, and technician verification run on live Supabase PostgreSQL, the core business workflows (reporting breakdowns, dispatching requests, drafting quotes, and updating repair steps) currently utilize the in-memory/localStorage store ([`src/lib/tb-store.ts`](file:///d:/Projects/TerraByte/src/lib/tb-store.ts)). This limitation will be systematically replaced by live Supabase queries and mutations in Phases 2 through 6.

---

## 3. Locked Technical Decisions

1. **Product Purpose**: TerraByte is a One-Stop Agricultural Equipment Repair Coordination Ecosystem.
2. **Core Outcome**: **REDUCE THE TIME BETWEEN EQUIPMENT BREAKDOWN AND GETTING BACK TO WORK.**
3. **No IoT/Hardware Mandate**: Pure software-first solution. Operates via mobile web without requiring custom OBD dongles or IoT sensors.
4. **Visual & UI Baseline**: Preserve the current high-contrast palette (`soil`, `primary`, `accent`, `warning`), typography (`Bricolage Grotesque`, `IBM Plex Sans`), and layout structure.
5. **Locked Tech Stack**:
   - **Frontend**: TanStack Start v1 + React 19 + Vite 8 + Tailwind CSS 4 + TanStack Router v1 + TanStack React Query v5.
   - **Backend**: Supabase (PostgreSQL 17, Supabase Auth, Supabase Storage, Row Level Security).
   - **AI Layer**: Google Gemini API (server-side, planned for Phase 8; deterministic rules serve as offline fallback).
   - **Protocol**: Model Context Protocol (MCP) via `@lovable.dev/mcp-js`.
6. **Authentication Architecture (Supabase Auth ONLY)**:
   - **Clerk is completely rejected and excluded** from the codebase and architecture.
   - All identity, registration, session persistence, and credential verification are managed by **Supabase Auth**.
   - No phone SMS OTP (eliminates high carrier costs and SMS gateway setup overhead). Standard email + password authentication is the production baseline.
7. **Role Provisioning & Authorization Discipline**:
   - **Farmer**: Public signup $\rightarrow$ automatically assigned role `'farmer'` with `is_verified = true`.
   - **Technician**: Public registration $\rightarrow$ creates profile with role `'technician'` and status `is_verified = false`. Strictly blocked from taking jobs until approved by the Service Centre.
   - **Service Centre / Admin**: **No public registration**. Admin accounts are provisioned exclusively by system administrators or designated seed setup.
   - **Zero Client Elevation**: Postgres database triggers block client requests from modifying `role` or `is_verified`.
8. **Target Regional Geography**: Demo data, crop contexts, machine brands, and regional terminology are anchored in **Nashik, Maharashtra** (onion, grape, sugarcane, wheat belts; Mahindra, John Deere, Kubota, Swaraj equipment).
9. **Transparent Demo Markers**: All simulated demo data must be explicitly tagged (`DEMO DATA`).
10. **Phased Discipline**: One phase at a time. Strict approval gate before beginning each phase.

---

## 4. Planned Demo Login Feature (Future Minor Enhancement)

To enable seamless review and demonstration during hackathon evaluations, a **Quick Demo Login** component will be added to the `/login` screen in a future iteration:
- Three 1-click action buttons: `[ Farmer Demo ]`, `[ Technician Demo ]`, `[ Service Centre Demo ]`.
- **Strict Implementation Rule**: These buttons will **autofill real credentials** into the form fields and trigger the normal `supabase.auth.signInWithPassword()` API call.
- **Zero Auth Bypass**: It must never mock or bypass the real Supabase session exchange.
- **Prerequisite**: Demo accounts must be provisioned and verified in the active Supabase project before enabling this UI helper.

---

## 5. Phase History & Milestones

- **2026-10-01 (Phase 0 — Baseline Audit)**: Inspected repository post-Lovable reset. Audited 17 key architectural items. Confirmed pure Supabase stack and identified legacy files (`src/lib/supabase.ts`, `src/types/database.ts`, stale migrations, old documentation).
- **2026-10-01 (Phase 1 — Codebase Cleanup + Documentation Reset)**:
  - Safely deleted confirmed obsolete files: `src/lib/supabase.ts`, `src/types/database.ts`.
  - Removed stale `.env.local` and `supabase/.temp/*` cache containing obsolete project ref and Clerk key.
  - Empirically verified remote database `fmnzoovazqpyaebqmqyo` contains only `profiles` and `technician_profiles`.
  - Safely moved legacy Clerk-era migrations (`20260930000001`–`20260930000005`) into `supabase/migrations_legacy_archive/` to keep the active migration chain clean.
  - Retained `supabase/seed.sql` for replacement in Phase 2.
  - Overhauled core documentation suite (`PROJECT_STATE.md`, `TRD.md`, `APP_FLOW.md`, `IMPLEMENTATION_PLAN.md`, `TESTING.md`) to reflect current codebase reality.
