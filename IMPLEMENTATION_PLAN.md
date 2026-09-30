# TerraByte — Implementation Plan

## Project Philosophy & Build Rules

1. **Build ONE Phase at a Time**: Complete all tasks, deliverables, and verification checks within a phase before moving to the next.
2. **Never Start Future Phases Automatically**: A coding agent must never assume approval or initiate downstream phases without explicit user instruction.
3. **Verification Gates**: Every phase has a mandatory verification gate (`tsc`, `lint`, `build`, manual flow checks). If any gate fails, fix it within the current phase.
4. **Preserve UI and Architecture**: Do not redesign screens, change the visual language, or introduce unapproved frameworks.
5. **No Secret Leaks**: Never hardcode API keys, database passwords, or auth tokens in client code or Git tracking.

---

## Phase 1 — UX Architecture & Wireframing
**Status**: **COMPLETE**
- Defined user roles (Farmer, Technician, Service Centre Dispatcher).
- Established downtime-reduction status state machine (`REQUESTED` $\rightarrow$ `ACCEPTED` $\rightarrow$ `QUOTE_PENDING` $\rightarrow$ `IN_PROGRESS` $\leftrightarrow$ `WAITING_FOR_PARTS` $\rightarrow$ `COMPLETED`).
- Authored ASCII structural wireframes for 4 Farmer screens, 2 Technician workspaces, and 1 Admin console.
- Formulated responsive matrix, error/empty/loading states, and visual design principles.

---

## Phase 1.5 — Lovable UI Migration & Normalization
**Status**: **COMPLETE**
- Removed all proprietary `@lovable.dev` dependencies, taggers, and config files.
- Normalized build toolchain to standard React 19 SPA + Vite 8 + Tailwind CSS 4 + TanStack Router.
- Preserved existing interactive demo functionality and all 11 client-side routes.

---

## Phase 2 — Supabase Foundation, Database Schema & Seed Data
**Status**: **COMPLETE**
- Connected local development to remote Supabase project `TerraByte` (`hwdrypkvszwrcraujctw`) in `ap-south-1` (Mumbai).
- Authored and deployed 5 PostgreSQL migrations:
  - 5 custom ENUM types, 10 relational tables, 17 indexes, updated-at triggers.
  - Granular Row Level Security (RLS) policies and security definer helper functions on 100% of tables.
  - Storage buckets `equipment-media` (5 MB) and `repair-media` (10 MB) with public view and authenticated upload policies.
  - Standard role permissions (`GRANT`) for `anon` and `authenticated` roles.
- Loaded deterministic, idempotent seed data into remote PostgreSQL instance covering 3 farmers, 5 technicians, 1 admin, 5 equipment records, 3 active repairs, quotes, timelines, and service histories.
- Established safe environment configuration (`.env.local` gitignored, `.env.example` clean with placeholders only).
- Verified TypeScript database definitions in `src/types/database.ts` and initialized typed Supabase client in `src/lib/supabase.ts`.
- Updated application branding with custom Lucide Tractor SVG favicon (`public/favicon.svg`).

---

## Phase 3 — Clerk Authentication & Identity
**Status**: **NEXT (ON BRANCH `phase-3-clerk-setup`)**

### Phase 3 Overview
Phase 3 establishes real user identity using Clerk (Email + Password and Google OAuth), strictly separating identity from Supabase role-based authorization, adding a dedicated `clerk_user_id` mapping column to `profiles`, enforcing role provisioning rules, and eliminating the mock demo role selector.

### Architecture & Identity Model
- **Identity Provider (Clerk)**: Handles user identity, credentials, Google OAuth, session tokens, and security events.
- **Authorization & Data (Supabase)**: Stores user profiles, roles, fleet records, and business workflows.
- **Dedicated Identity Field**: Preserves internal `profiles.id` (UUID) as the primary key for all relations across the database, and adds `profiles.clerk_user_id TEXT UNIQUE` (`20260930000006_add_clerk_identity.sql`).
- **No Phone Auth**: Phone SMS OTP is completely removed (avoids SMS provider dependency).
- **Role Provisioning Rules**:
  - **Farmer**: Public registration automatically assigns `role = 'farmer'`. Immediately enters `/farmer` workspace.
  - **Technician**: Public registration via "Register as Technician" registers an account with status `PENDING` (`is_verified = false`). Hard-gated to `/technician/pending` screen until manually approved by an administrator in Supabase.
  - **Service Centre / Admin**: No public registration allowed. Admin accounts are provisioned strictly by existing administrators. Users cannot self-select Admin.

### Deliverables & Tasks
1. **Schema & RLS Helper Migration**:
   - Add `clerk_user_id TEXT UNIQUE` with index to `public.profiles` (`20260930000006_add_clerk_identity.sql`); leave `profiles.id` and `auth_user_id` intact.
   - Update RLS helper functions `current_clerk_id()`, `current_profile_id()`, and `current_user_role()` to resolve the authenticated Clerk subject (`auth.jwt() ->> 'sub'`) to internal `profiles.id` (UUID), preserving server-side RLS enforcement across all 10 tables.
   - Update `profiles` update/insert policies to check `clerk_user_id = public.current_clerk_id()`.
2. **Clerk React SDK & Supabase JWT Setup**: Wrap application root in `<ClerkProvider>` using `VITE_CLERK_PUBLISHABLE_KEY`; configure Clerk Supabase JWT template (`template: 'supabase'`); configure typed Supabase client to pass authenticated Clerk JWT (`Authorization: Bearer <clerk_token>`) on all requests.
3. **Authentication Flows**: Implement Email + Password and Google OAuth sign-in and sign-up flows.
4. **Profile Synchronization & Routing**: On sign-in/sign-up, resolve `profiles.clerk_user_id = user.id`. Auto-provision Farmer profiles, flag new Technicians as pending (`is_verified = false`), and route to designated workspace (`/farmer`, `/technician`, `/technician/pending`, `/admin`).
5. **Route Protection & Guards**: Protect `/farmer/*`, `/technician/*`, `/admin/*` from unauthenticated or cross-role access.
6. **Auth UI Normalization**: Remove pre-auth role selector tabs and demo persona buttons on `/login`. Implement clean login/register forms with Google OAuth and collapsible demo credentials helper card.
7. **Nagpur Seed User Accounts**: Configure seed test accounts in Clerk linked to Nagpur demo profiles.

- **Deliverable**: Functional, secure authentication and role gatekeeping with zero mock persona switching.
- **Verification**: Farmer sign-in lands on `/farmer`; new technician lands on `/technician/pending`; approved technician lands on `/technician`; unauthenticated and cross-role requests are blocked.

---

## Phase 4 — Repair Workflow Integrity
**Status**: **PLANNED**

### Phase 4 Overview
Phase 4 connects Farmer, Technician, and Service Centre workspaces to live PostgreSQL tables via Supabase, enforces the end-to-end repair state machine, and safely retires the `localStorage` mock store (`tb-store.ts`).

### Deliverables & Tasks
1. **Farmer Workspace Integration**: Wire `/farmer`, `/farmer/equipment`, `/farmer/report-breakdown`, and `/farmer/repair/:id` to live Supabase tables (`equipment`, `repair_requests`, `quotes`, `service_history`). Connect media uploads to `equipment-media` and `repair-media` buckets.
2. **Technician Workspace Integration**: Wire `/technician` and `/technician/job/:id` to live repair orders. Implement job acceptance, itemized quote builder (`quotes`, `quote_items`), status toggling (`IN_PROGRESS`, `WAITING_FOR_PARTS`), and completion handover.
3. **Parts Blocker Visibility**: When a technician marks a repair `WAITING_FOR_PARTS`, the farmer view dynamically displays an alert banner showing the exact part name and expected arrival ETA.
4. **Service Centre / Admin Console**: Wire `/admin` to query regional repairs, calculate real-time downtime metrics, flag unaccepted requests (>30 mins), and provide manual technician reassignment.
5. **Quote Lifecycle & Negotiation**: Implement transparent quote approval, decline with reason checklist, and quote revision tracking (`version = 2`).
6. **State Machine Hard Gates**: Enforce valid transitions (`REQUESTED` $\rightarrow$ `ACCEPTED` $\rightarrow$ `QUOTE_PENDING` $\rightarrow$ `IN_PROGRESS` $\leftrightarrow$ `WAITING_FOR_PARTS` $\rightarrow$ `COMPLETED`). Block illegal skips.
7. **Decommission Mock Store**: Safely replace `src/lib/tb-store.ts` mutations with React Query hooks calling Supabase client; maintain graceful read fallback for offline demo execution.

- **Deliverable**: Complete persistent repair workflow operating 100% on live Supabase PostgreSQL.
- **Verification**: Submitting a breakdown creates a database record; approving a quote authorizes work; technician completion records an immutable entry in machine service history.

---

## Phase 5 — AI Triage / Assessment
**Status**: **PLANNED**

### Phase 5 Overview
Phase 5 integrates Google Gemini 2.0 API via a secure Supabase Edge Function to provide assistive diagnostic triage for farmers reporting equipment breakdowns.

### Deliverables & Tasks
1. **Supabase Edge Function (`analyze-breakdown`)**: Deploy server-side Edge Function proxying requests to Gemini API; store `GEMINI_API_KEY` securely in Supabase Secrets (never expose in client code).
2. **Structured Diagnostic Schema**: Edge Function accepts breakdown symptoms, description, and image base64, returning validated JSON: `{ likely_issue, severity, parts_category, safety_advice }`.
3. **Assistive UI Presentation**: Render diagnostic results with prominent "Assistive AI Hypothesis" badge, clearly indicating physical technician inspection is required.
4. **Resilient Fallback**: If Gemini API times out or errors, fall back gracefully to rule-based keyword matching without blocking the farmer's intake.

- **Deliverable**: Assistive AI intake hypothesis embedded into the breakdown reporting journey.
- **Verification**: Breakdown intake returns structured diagnostic hypothesis; network inspection reveals zero client-side Gemini key exposure.

---

## Phase 6 — Notifications, Polish & Demo Readiness
**Status**: **PLANNED**

### Phase 6 Overview
Phase 6 brings real-time operational feedback, responsive ergonomics, and curated regional demo narratives to ensure flawless presentation.

### Deliverables & Tasks
1. **Real-time Notifications**: Listen to Supabase Realtime subscriptions on `repair_requests` and `quotes` to update farmer and technician views instantaneously without manual page refreshes.
2. **Mobile Ergonomics & Accessibility**: Audit and guarantee minimum 48px touch targets, WCAG AA color contrast, keyboard navigation, and responsive layouts across mobile, tablet, and desktop viewports.
3. **Curated Nagpur Demo Scenarios**: Seed 3 compelling narrative scenarios in the Vidarbha region:
   - *Harvest Crisis*: Harvester broken down during harvest $\rightarrow$ urgent dispatch $\rightarrow$ matched specialist.
   - *Transparent Pricing*: Farmer reviews itemized parts/labour quote $\rightarrow$ 1-tap approval $\rightarrow$ work authorized.
   - *Parts Blocker Visibility*: Technician waiting on hydraulic cylinder $\rightarrow$ farmer sees exact part and arrival time.
4. **Evaluator Quick-Login**: Collapsible demo credentials drawer for rapid evaluation.

- **Deliverable**: Polished, responsive application primed for live demonstration.
- **Verification**: Realtime events update in < 1 second across dual browser windows; mobile layouts render without horizontal scroll or clipping.

---

## Phase 7 — Testing, Security & Deployment
**Status**: **PLANNED**

### Phase 7 Overview
Phase 7 validates system security, executes comprehensive end-to-end acceptance testing, and deploys the production build.

### Deliverables & Tasks
1. **Acceptance Testing Suite**: Execute all test suites defined in `TESTING.md` (Authentication `AUTH-01` to `AUTH-14`, RLS `RLS-01` to `RLS-07`, Farmer `FARM-01` to `FARM-08`, Technician `TECH-01` to `TECH-07`, Admin `ADM-01` to `ADM-04`).
2. **Row Level Security Audit**: Verify cross-farmer data isolation, unauthorized mutation prevention, and role-based access enforcement.
3. **Production Deployment**: Build optimized client bundle with Vite; deploy to Vercel with SPA rewrite rules (`vercel.json`); verify environment variable injection.
4. **Documentation & Video Walkthrough**: Finalize repository README, architecture diagrams, and record a 3-minute video walkthrough showcasing the complete breakdown-to-repair journey.

- **Deliverable**: Fully tested, verified, and deployed TerraByte production system.
- **Verification**: Zero failed tests in `TESTING.md`; zero security policy leaks; live production URL running with full functionality.

---

## Out of Scope Boundaries (Strictly Postponed)

The following features must NOT be built during the current MVP hackathon phases:
1. Native iOS / Android mobile applications (Web responsive SPA only).
2. Payment gateway integration (Razorpay/Stripe) — cash on delivery / workshop direct billing is simulated.
3. Live GPS telemetry / OBD-II dongles / hardware IoT sensors.
4. Third-party accounting/ERP integrations (Tally, SAP).
5. Multi-lingual voice translation models (voice dictation uses native browser input).
6. Multi-tenant SaaS subscription billing.
