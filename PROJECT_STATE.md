# TerraByte — Project State

## 1. Current Phase

- **Current Phase**: **PHASE 2 — COMPLETE** (Supabase Foundation, Relational Schema, Storage & Verified Seed Data)
- **Next Phase**: **PHASE 3 — NEXT** (Clerk Authentication + Real Supabase Data Integration on branch `phase-3-clerk-setup`)

---

## 2. Current Project Status

TerraByte is a digital agricultural equipment repair ecosystem designed to coordinate the complete journey from machinery breakdown to completed repair.

- **Phase 1 (UX Architecture)**: COMPLETE.
- **Phase 1.5 (Frontend Normalization)**: COMPLETE (React 19 SPA + Vite 8 + Tailwind CSS 4 + TanStack Router).
- **Phase 2 (Supabase Foundation)**: COMPLETE. Live PostgreSQL database deployed on Supabase (`hwdrypkvszwrcraujctw`, `ap-south-1`) with 5 migrations, 10 tables, active RLS on 100% of tables, 2 public storage buckets, and verified seed data.
- **Phase 3 Preparation**: Reverted premature experimental Supabase OTP code. Standardized on **Clerk** for identity/authentication, strictly decoupling identity from Supabase role-based authorization. Ready to create branch `phase-3-clerk-setup`.

The UI currently operates safely on the existing interactive baseline (`tb-store.ts`) with zero broken routes and zero runtime regressions.

---

## 3. Implemented

- **React 19 SPA + Vite 8**: Clean, modern single-page application with Tailwind CSS 4, Radix UI primitives, and Lucide React icons.
- **TanStack Router**: 11 client-side routes across Farmer, Technician, and Admin workspaces.
- **Existing TerraByte UI Baseline**: Preserved visual design, branding, and interactive demo repair workflow.
- **Brand SVG Favicon**: Custom Lucide Tractor mark (`public/favicon.svg`) aligned with the application header and login screen; legacy `favicon.ico` removed.
- **Supabase Cloud Project**: Live PostgreSQL instance on Supabase (`hwdrypkvszwrcraujctw`, `ap-south-1`).
- **5 Applied PostgreSQL Migrations**:
  - `20260930000001_initial_schema.sql`: 5 ENUMs, 10 tables, triggers, indexes, helper functions, and base RLS policies.
  - `20260930000002_storage_setup.sql`: Storage buckets `equipment-media` and `repair-media` with RLS.
  - `20260930000003_grant_permissions.sql`: Standard permissions for `anon` and `authenticated` roles.
  - `20260930000004_storage_policies.sql`: Public bucket visibility and query helpers.
  - `20260930000005_verify_rls_helper.sql`: RPC helper verifying RLS enablement across all tables.
- **Row Level Security (RLS)**: Verified enabled (`rls_enabled: true`) across 100% of application tables with 2–4 enforced policies per table.
- **Storage Buckets**: `equipment-media` (5 MB limit) and `repair-media` (10 MB limit) verified accessible via client SDK.
- **Deterministic Seed Data**: Seed script (`supabase/seed.sql`) verified on cloud database (3 farmers, 5 technicians, 1 admin, 5 equipment records, 3 active repairs, quotes, timeline events, and service history).
- **TypeScript Database Typings**: Strongly-typed schema definitions in `src/types/database.ts` and typed client in `src/lib/supabase.ts`.
- **Safe Environment Configuration**: Real credentials kept strictly in gitignored `.env.local`; `.env.example` verified clean with generic placeholders only; zero secrets in Git tracking or history.
- **Code Quality & Build Gates**: `tsc --noEmit`, `npm run lint`, and `npm run build` all passing with 0 errors.

---

## 4. Not Yet Implemented

- **Clerk Authentication Setup**: Integration of Clerk React SDK for identity management (Stage 3A).
- **Login Options**: Email + Password and Google OAuth via Clerk (Stage 3A).
- **Farmer Public Signup**: Automatic assignment of `farmer` role in Supabase upon registration (Stage 3B).
- **Technician Registration & Approval Gate**: Public technician application creation with status `PENDING`; access to Technician Dashboard blocked until verified/approved (Stage 3C).
- **Service Centre / Admin Manual Provisioning**: Admin accounts strictly provisioned by system administrator; zero public signup (Stage 3D).
- **Nagpur Demo Data Migration**: Transitioning seed data geography from Nashik to Nagpur, Maharashtra (Vidarbha agrarian belt) (Stage 3E).
- **UI $\rightarrow$ Supabase Integration**: Wiring Farmer, Technician, and Admin views to live Supabase queries and mutations (Stages 3F, 3G, 3H).
- **Retiring localStorage Dependency**: Replacing `src/lib/tb-store.ts` mock mutations with live React Query hooks (Stage 3I).
- **Complete Persistent Repair Workflow & Edge Cases**: Live quote decline/revision path, cancellation, realtime notifications (Phase 4).
- **Gemini Assistive Diagnostic Assessment**: Supabase Edge Function with Google Gemini 2.0 API integration (Phase 5).
- **Production Deployment**: Vercel deployment with SPA rewrites, performance optimization (Phase 6).
- **Hackathon Demo Package**: Curated narrative demo walkthrough scenarios and final submission assets (Phases 7 & 8).

---

## 5. Locked Decisions

Future AI coding agents and human contributors must **not** silently change or violate these locked decisions:

1. **Product Purpose**: TerraByte is a One-Stop Agricultural Equipment Repair coordination ecosystem.
2. **Central Product Outcome**: **REDUCE THE TIME BETWEEN EQUIPMENT BREAKDOWN AND GETTING BACK TO WORK.**
3. **Software-First Solution**: No custom IoT hardware or OBD telematics required for MVP operation.
4. **Visual Baseline**: The existing UI design, styling, and color language are intentional and must be preserved.
5. **Locked Tech Stack**: React 19 + Vite 8 + Tailwind CSS 4 + TanStack Router + Clerk (Identity) + Supabase (PostgreSQL, Storage, RLS) + Google Gemini API.
6. **Authentication Architecture (Clerk)**:
   - Clerk handles **identity** (who you are: User ID, Email, Google account).
   - Login options: **Email + Password** and **Google OAuth**.
   - **Phone login / phone OTP is completely removed** (avoids expensive SMS provider requirements).
   - **Email OTP is postponed** unless required by Clerk's final configuration.
7. **Role Provisioning & Authorization Architecture**:
   - **Authentication and authorization remain strictly separate**: Clerk handles identity; TerraByte/Supabase handles roles and permissions.
   - **Farmer**: Public signup $\rightarrow$ automatically assigned `farmer` role.
   - **Technician**: Public "Register as Technician" $\rightarrow$ authenticated user creates technician application $\rightarrow$ status `PENDING` $\rightarrow$ **no Technician Dashboard access until approved**.
   - **Service Centre / Admin**: **No public registration**. Account is manually provisioned by the administrator.
   - **Users must never select Service Centre/Admin themselves**.
   - No pre-auth role selector tabs; no client-side impersonation.
8. **Supabase Backend Foundation**: Supabase is the single backend for PostgreSQL database, business data, object storage, and edge functions.
9. **Assistive AI Role**: AI serves strictly as an assistive intake diagnostic tool; it is never the entire product and never pretends to be an infallible mechanic.
10. **Demo Data Transparency**: All simulated seed data must be explicitly labeled with `DEMO DATA` markers. Never claim unverified field validation or real-world customer traction.
11. **Target Demo Geography**: Demo data will be set in Nagpur, Maharashtra (Vidarbha agrarian region).
12. **RLS Enforcement**: Least-privilege data access must be enforced by PostgreSQL Row Level Security on every table.
13. **Phased Discipline**: Build ONE phase at a time. Never start future phases automatically.
14. **Dedicated Branch for Phase 3**: Phase 3 development takes place on branch `phase-3-clerk-setup`.
15. **Documentation Architecture**: The five authoritative documentation files are:
    - `PROJECT_STATE.md` (Current state & memory)
    - `TRD.md` (Technical requirements & architecture)
    - `APP_FLOW.md` (User journeys & screen flows)
    - `IMPLEMENTATION_PLAN.md` (Phased build sequence)
    - `TESTING.md` (Test matrix & release gates)

---

## 6. Open Decisions

The following technical and product decisions remain genuinely unresolved and are slated for alignment during Phase 3 and Phase 4:

1. **Clerk to Supabase Token Exchange**:
   - When calling Supabase from the frontend, should the application use Clerk's Supabase JWT integration (Clerk third-party auth template), or map Clerk's user ID directly into `profiles.auth_user_id` using standard Supabase client queries?
   - *Current Recommendation*: Direct user ID mapping (`profiles.auth_user_id = clerkUser.id`) using public anon client with row-level ownership checks, minimizing token exchange overhead for hackathon MVP.
2. **Quote Decline & Negotiation UX**:
   - When a farmer declines a quote, should the system provide a structured counter-offer slider, or strictly offer a 1-tap **[Call Technician to Discuss]** button paired with a quick rejection reason checklist?
   - *Current Recommendation*: 1-tap phone call + simple rejection reason chips to prevent complex multi-turn negotiation UI on mobile.
3. **Technician Acceptance SLA Threshold**:
   - If an incoming breakdown request is not accepted by the primary matched technician, what duration should elapse before it auto-cascades to the next nearest workshop or triggers an amber alert on the Admin console?
   - *Current Recommendation*: 30 minutes for normal requests; 15 minutes for requests flagged "Urgent Harvest Window".

---

## 7. Documentation Map

- [`PROJECT_STATE.md`](file:///d:/Projects/TerraByte/PROJECT_STATE.md): Current implementation state, verified milestones, locked decisions, open decisions, and active agent memory.
- [`TRD.md`](file:///d:/Projects/TerraByte/TRD.md): Technical Requirements Document — architecture, Clerk identity, functional specifications, data models, security rules, and definition of done.
- [`APP_FLOW.md`](file:///d:/Projects/TerraByte/APP_FLOW.md): Application Flow Document — entry points, Clerk authentication flow, pending technician gate, farmer/technician/admin journeys, state machine, and ASCII wireframes.
- [`IMPLEMENTATION_PLAN.md`](file:///d:/Projects/TerraByte/IMPLEMENTATION_PLAN.md): Implementation Plan — completed phases, granular Phase 3 stages (3A–3I for Clerk & Supabase), planned future phases, and out-of-scope boundaries.
- [`TESTING.md`](file:///d:/Projects/TerraByte/TESTING.md): Testing Guide — critical user journeys, Clerk auth test cases, pending technician gate tests, RLS test matrix, responsive checks, accessibility, security, and release blockers.

---

## 8. Change Log

- **2026-09-26**: **Phase 1 Complete**. Established initial UX architecture, wireframes, user roles, downtime reduction principles, and unified Repair Hub concept.
- **2026-09-29**: **Phase 1.5 Complete**. Normalized frontend build toolchain; completely removed Lovable dependencies; restored clean React 19 SPA + Vite + Tailwind CSS + TanStack Router architecture.
- **2026-09-30 (Morning)**: **Phase 2 Complete**. Connected remote Supabase project `hwdrypkvszwrcraujctw` (Mumbai); applied 5 migrations defining 10 tables, triggers, indexes, and RLS; configured `equipment-media` and `repair-media` storage buckets; loaded deterministic demo seed data; aligned tractor SVG favicon; verified build and preview across all 11 routes.
- **2026-09-30 (Afternoon)**: **Documentation System Reorganization**. Reorganized project documentation into the four-document system (`TRD.md`, `APP_FLOW.md`, `IMPLEMENTATION_PLAN.md`, `TESTING.md`) with `PROJECT_STATE.md` as current state memory.
- **2026-09-30 (Evening)**: **Authentication Architecture Pivot to Clerk**. Reverted experimental Supabase OTP code to clean Phase 2 baseline. Updated authentication architecture to Clerk (Email + Password and Google OAuth). Decoupled Clerk identity from Supabase authorization/roles. Established Farmer auto-role assignment, Technician `PENDING` approval gate, and Admin manual provisioning.
