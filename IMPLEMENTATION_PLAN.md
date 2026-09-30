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

## Phase 3 — Authentication + Real Supabase Data Integration
**Status**: **NEXT (TO BE EXECUTED ONE STAGE AT A TIME)**

### Phase 3 Overview
Phase 3 replaces the mock `localStorage` store ([`tb-store.ts`](file:///d:/Projects/TerraByte/src/lib/tb-store.ts)) and demo role selector with real Clerk Authentication for identity management, Supabase PostgreSQL for authorization/business data, automatic role resolution, live database queries/mutations, and regional demo data aligned with Nagpur, Maharashtra.

**Authentication & Role Provisioning Architecture**:
- **Identity Provider**: Clerk handles authentication (user identity, credentials, Google OAuth, session management).
- **Authorization & Data**: Supabase PostgreSQL stores user profiles (`profiles.auth_user_id = clerk_user_id`), roles, fleet records, and business workflows.
- **Login Options**: Email + Password and Google OAuth. Phone SMS OTP is completely removed (avoids SMS provider dependency).
- **Farmer Role**: Public registration automatically assigns `role = 'farmer'`. Immediately enters `/farmer` workspace.
- **Technician Role**: Public registration via "Register as Technician" registers an account with status `PENDING`. Hard-gated to `/technician/pending` screen until manually approved by an administrator in Supabase.
- **Service Centre / Admin Role**: No public registration allowed. Admin accounts are provisioned strictly by existing administrators. Users cannot self-select Admin.

---

### Stage 3A — Clerk SDK Integration & Authentication Setup
- **Objective**: Implement user identity management using Clerk React SDK (`@clerk/clerk-react`).
- **Dependencies**: Completed Phase 2 Supabase foundation; Clerk project environment keys (`VITE_CLERK_PUBLISHABLE_KEY`).
- **Tasks**:
  1. Wrap application root in `<ClerkProvider>` with publishable key from environment variables.
  2. Configure Email + Password and Google OAuth authentication providers.
  3. Implement secure sign-out mechanism in top navbar that clears Clerk session and local query cache.
  4. Implement persistent session listener and auth status hooks (`useUser`, `useAuth`).
  5. Add route guard protecting `/farmer/*`, `/technician/*`, and `/admin/*` routes from unauthenticated access.
- **Deliverable**: Working login, signup, Google OAuth, logout, and protected route redirection via Clerk.
- **Verification**: Valid email/password or Google OAuth logs in; invalid credentials show clear error; logged-out users cannot access protected routes.
- **Out of Scope**: Phone SMS OTP gateways (eliminated); email magic links / OTP (Email+Password and Google OAuth only).

---

### Stage 3B — Profile Provisioning & Automatic Role Resolution
- **Objective**: Automatically synchronize Clerk user identity with Supabase `profiles` and route users to their designated workspace based on `profiles.role` and approval status.
- **Dependencies**: Stage 3A.
- **Tasks**:
  1. On authentication, check Supabase `profiles` for matching `auth_user_id = user.id`. If absent, provision profile row:
     - Default public signup $\rightarrow$ `role = 'farmer'`.
     - Technician signup flow $\rightarrow$ `role = 'technician'`, create `technician_profiles` with `status = 'PENDING'`.
  2. Implement role-based navigation and gatekeeper:
     - `farmer` $\rightarrow$ `/farmer`
     - `technician` (approved) $\rightarrow$ `/technician`
     - `technician` (pending) $\rightarrow$ `/technician/pending` (informational review banner; dashboard blocked)
     - `admin` $\rightarrow$ `/admin`
  3. Prevent cross-role access (e.g., farmer manually navigating to `/admin` is redirected back to `/farmer`).
  4. Ensure Admin accounts cannot be self-provisioned through public flows.
- **Deliverable**: Automatic, secure role-based navigation and technician verification gate without client-side role picking.
- **Verification**: Logging in as farmer lands on `/farmer`; new technician lands on `/technician/pending`; approved technician lands on `/technician`; cross-role navigation blocked.

---

### Stage 3C — Remove Demo Role Selector & Polish Auth UI
- **Objective**: Completely eliminate the mock demo role selector and client-side impersonation in favor of a clean Clerk-integrated login/register UI.
- **Dependencies**: Stages 3A & 3B.
- **Tasks**:
  1. Remove the pre-auth role tabs (`Farmer`, `Technician`, `Service Centre`) on `/login`.
  2. Remove visible demo persona buttons (`Balasaheb Patil`, `Ramesh Kumar`, etc.) from the login interface.
  3. Remove client-side role switching actions (`actions.login(role, who)`).
  4. Build unified login screen with Email/Password inputs, Google OAuth one-click button, and "Register as Farmer" / "Register as Technician" links.
  5. Provide pre-seeded demo account credentials in a collapsible, clean helper card on the login screen for testing convenience (e.g. `farmer@terrabyte.demo` / `password123`).
- **Deliverable**: Standard, professional authentication form with zero pre-auth personification.
- **Verification**: No persona names visible before authentication; login requires actual credentials or Google OAuth.

---

### Stage 3D — Nagpur Demo Data & User Provisioning
- **Objective**: Migrate seed data geography from Nashik to Nagpur, Maharashtra (Vidarbha agrarian belt) and configure corresponding test profiles.
- **Dependencies**: Stage 3C.
- **Tasks**:
  1. Update `supabase/seed.sql` with authentic Nagpur locations (Saoner, Kalmeshwar, Katol, Umred, Hingna, Nagpur MIDC).
  2. Provision 3 seed user accounts in Clerk and link to Supabase profiles:
     - Farmer: `farmer.nagpur@terrabyte.demo`
     - Approved Technician: `tech.nagpur@terrabyte.demo`
     - Service Centre / Admin: `admin.nagpur@terrabyte.demo`
     - Pending Technician: `tech.pending@terrabyte.demo` (for testing pending gate)
  3. Ensure all seed records are explicitly labeled with `DEMO DATA` tags.
  4. Ensure internal consistency across machinery types (Mahindra, John Deere, Swaraj), crop contexts (cotton, soybean, orange orchards), and realistic replacement parts.
- **Deliverable**: Fresh, idempotent seed migration reflecting Nagpur region.
- **Verification**: Database contains Nagpur-based records with correct foreign-key relationships.

---

### Stage 3E — Farmer Workspace Supabase Integration
- **Objective**: Connect Farmer screens to live Supabase queries and mutations.
- **Dependencies**: Stages 3B & 3D.
- **Tasks**:
  1. Wire `/farmer` (Home) to fetch active repairs and registered equipment from `repair_requests` and `equipment`.
  2. Wire `/farmer/equipment` to fetch machinery fleet and historical logs from `service_history`.
  3. Wire `/farmer/report-breakdown` to insert new rows into `repair_requests` with symptoms, photos, and location.
  4. Wire `/farmer/repair/:id` to fetch live status, quote details (`quotes`, `quote_items`), timeline, and handle `[Approve Quote]` mutation.
  5. Connect photo uploads to `equipment-media` and `repair-media` storage buckets.
- **Deliverable**: Fully functioning Farmer journey persisting to remote Supabase.
- **Verification**: Submitting a breakdown creates a database row; approving a quote updates `quotes.status` to `APPROVED` and `repair_requests.status` to `IN_PROGRESS`.

---

### Stage 3F — Technician Workspace Supabase Integration
- **Objective**: Connect Technician screens to live Supabase data.
- **Dependencies**: Stages 3B & 3E.
- **Tasks**:
  1. Wire `/technician` (Dashboard) to fetch incoming `REQUESTED` jobs and assigned active jobs.
  2. Wire `[Accept Job]` action to update `technician_id` and transition status to `ACCEPTED`.
  3. Wire `/technician/job/:id` to formulate quotes: inserting into `quotes` and `quote_items`.
  4. Wire status toggle actions (`IN_PROGRESS`, `WAITING_FOR_PARTS` with notes/ETA, `COMPLETED`).
  5. Wire completion action to create an immutable `service_history` record bound to the equipment.
- **Deliverable**: Fully functioning Technician workspace with live quoting and status updates.
- **Verification**: Created quote appears immediately on farmer's screen; marking parts delay shows blocker banner on farmer view; completing job writes to service history.

---

### Stage 3G — Service Centre / Admin Supabase Integration
- **Objective**: Connect Admin console to live operational data.
- **Dependencies**: Stages 3E & 3F.
- **Tasks**:
  1. Wire `/admin` to query all regional `repair_requests` and calculate real-time downtime metrics.
  2. Implement unassigned request alert badge (> 30 mins).
  3. Implement manual technician reassignment mutation updating `repair_requests.technician_id`.
  4. Connect parts blocker oversight filter.
- **Deliverable**: Live dispatch and oversight console for service centre coordinators.
- **Verification**: Reassigning a technician updates the job and alerts the new technician in their feed.

---

### Stage 3H — Retire localStorage Dependency
- **Objective**: Safely decommission mock store mutations in `src/lib/tb-store.ts`.
- **Dependencies**: Stages 3E, 3F, 3G.
- **Tasks**:
  1. Replace `tb-store.ts` mutations with React Query hooks calling Supabase client.
  2. Maintain a graceful read fallback for offline demo caching if connection is interrupted.
  3. Clean up obsolete mock state code.
- **Deliverable**: Application operates 100% on Supabase without relying on `localStorage` as primary storage.
- **Verification**: Browser localStorage can be cleared completely without breaking application data.

---

### Stage 3I — RLS & Multi-Role Security Verification
- **Objective**: Rigorously verify Row Level Security across all 3 roles.
- **Dependencies**: Stages 3A–3H.
- **Tasks**:
  1. Test Farmer A attempting to read Farmer B's equipment or repairs $\rightarrow$ returns empty.
  2. Test Technician attempting to approve a quote $\rightarrow$ rejected by RLS.
  3. Test unauthenticated user attempting to insert repairs $\rightarrow$ rejected.
  4. Verify all tests in `TESTING.md` Section 4 pass.
- **Deliverable**: Verified security sign-off for Phase 3.
- **Verification**: Zero unauthorized data reads or writes.

---

## Phase 4 — Complete Repair Workflow & Edge Cases
**Status**: **PLANNED**
- Support quote decline with reason selector and revision path (`QUOTE_REVISED`).
- Support repair cancellation from `REQUESTED` stage.
- Implement real-time notifications using Supabase Realtime subscriptions (listen to `quotes`, `repair_requests`).
- Offline indicator banner with automatic retry when connectivity returns.

---

## Phase 5 — Gemini Assistive Diagnostic Assessment
**Status**: **PLANNED**
- Deploy Supabase Edge Function `analyze-breakdown` with Google Gemini 2.0 API integration.
- Store Gemini API key in Supabase Secrets (`GEMINI_API_KEY`); never expose in client code.
- Edge Function accepts breakdown symptoms + image base64, returns validated structured JSON:
  `{ likely_issue, severity, parts_category, safety_advice }`.
- Client displays assistive assessment with prominent "Assistive AI Hypothesis" badge.
- Graceful fallback: If Gemini API times out or errors, fallback to rule-based category matching without blocking the farmer.

---

## Phase 6 — UX Polish, Reliability & Full Testing
**Status**: **PLANNED**
- Comprehensive mobile touch target pass (minimum 48px on all inputs/buttons).
- Full audit of WCAG AA contrast, keyboard navigation, and aria labels.
- Run complete `TESTING.md` suite across mobile, tablet, and desktop viewports.
- Deploy production bundle to Vercel with SPA rewrite rules (`vercel.json`).

---

## Phase 7 — Hackathon Demo Engineering
**Status**: **PLANNED**
- Seed 3 high-impact narrative demo scenarios in Nagpur region:
  1. *Harvest Crisis*: Harvester broken during harvest $\rightarrow$ 1-tap breakdown report $\rightarrow$ AI triage $\rightarrow$ matched specialist.
  2. *Transparent Pricing*: Farmer reviews itemized quote on tractor $\rightarrow$ approves in 1 tap $\rightarrow$ work authorized.
  3. *Parts Blocker Visibility*: Technician waiting on hydraulic cylinder $\rightarrow$ farmer sees exact part and arrival time, eliminating panic.
- Create 1-click Demo Quick-Login helper for hackathon evaluators.

---

## Phase 8 — Final Submission Package
**Status**: **PLANNED**
- Clean repository README with product narrative, architecture diagram, and setup instructions.
- Recorded 3-minute video walkthrough showcasing the complete breakdown-to-repair journey.
- Verification checklist sign-off.

---

## Out of Scope Boundaries (Strictly Postponed)

The following features must NOT be built during the current MVP hackathon phases:
1. Native iOS / Android mobile applications (Web responsive SPA only).
2. Payment gateway integration (Razorpay/Stripe) — cash on delivery / workshop direct billing is simulated.
3. Live GPS telemetry / OBD-II dongles / hardware IoT sensors.
4. Third-party accounting/ERP integrations (Tally, SAP).
5. Multi-lingual voice translation models (voice dictation uses native browser input).
6. Multi-tenant SaaS subscription billing.
