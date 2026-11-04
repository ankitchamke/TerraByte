<!-- refreshed: 2026-11-04 -->
# Architecture

**Analysis Date:** 2026-11-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client Tier (Browser / PWA)                            │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│    Farmer Portal     │ Technician Workbench │     Service Centre Desk       │
│  `src/routes/farmer` │`src/routes/technician`│     `src/routes/admin`        │
└──────────┬───────────┴──────────┬───────────┴───────────────┬───────────────┘
           │                      │                           │
           ▼                      ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Application Server Tier (TanStack Start / Nitro)         │
│  SSR & Routing: `src/server.ts`, `src/start.ts`, `src/routes/**`             │
│  API Endpoints: `src/routes/api/health.ts`, `src/routes/api/route-estimate.ts`│
│  AI Diagnostics: `src/routes/api/assess-visual-defect.ts`                    │
│  MCP Agent Server: `src/routes/mcp.ts`                                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Database & Backend Tier (Supabase)                      │
│  PostgreSQL 17 Engine (RLS Policies, Triggers, RPCs, 18 Domain Tables)       │
│  Realtime WebSocket Broadcasting (`src/hooks/use-repair-realtime.ts`)       │
│  Storage Buckets (`repair-photos`, `equipment-photos`, `avatars`)           │
│  External APIs: OSRM Routing, Google Routes API, Gemini 3.5, Groq Whisper    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Server Entry** | Normalizes SSR errors, traps h3 error bodies, and returns styled fallback pages | `src/server.ts` |
| **Start Config** | Configures CSRF protection and Supabase auth attacher middleware | `src/start.ts` |
| **Root Router** | Instantiates TanStack Router with QueryClient, scroll restoration, and meta headers | `src/router.tsx` |
| **Auth Service** | Handles sign-in, signup, sign-out, session restoration, and password reset | `src/lib/auth.ts` |
| **Repair Request Service** | Manages intake, triage assignment, status transitions, and timeline logs | `src/lib/services/repair-requests.ts` |
| **Quote Service** | Coordinates itemized estimates, revision history, and farmer approval | `src/lib/services/quotes.ts` |
| **Parts Desk Service** | Depot inventory, technician requisitions, atomic handoff, movements, and sales | `src/lib/services/parts-desk.ts` |
| **Routing Service** | Computes driving distance and ETA via OSRM with Google Routes API fallback | `src/lib/services/routing.ts` |
| **AI Diagnostics Service** | Runs multimodal tractor defect analysis via Google Gemini 3.5 Flash-Lite | `src/lib/services/gemini-diagnostic.ts` |
| **Audio Transcription** | Transcribes breakdown voice recordings via Groq Whisper Cloud API | `src/lib/services/transcription-service.ts` |
| **Realtime Hook** | Listens to Postgres changes via WebSocket and triggers coalesced cache invalidation | `src/hooks/use-repair-realtime.ts` |
| **Parts Pickup Card** | Interactive technician requisition UI for workshop and field jobs | `src/components/parts-pickup-card.tsx` |
| **Quote Comparison** | Line-by-line visual diff comparison between quote versions | `src/components/quote-comparison.tsx` |
| **Repair Chat** | Real-time messaging between farmer, assigned technician, and service centre | `src/components/repair-chat.tsx` |
| **Error Boundary** | Graceful isolation of component runtime exceptions | `src/components/component-error-boundary.tsx` |

## Pattern Overview

**Overall:** Full-stack React SSR with TanStack Start, layered service architecture, and PostgreSQL RLS-governed data access.

**Key Characteristics:**
- **Database as Sole Source of Truth:** Authoritative domain mutations and constraints run directly in PostgreSQL 17 via Row Level Security (RLS) policies and ACID-compliant stored procedures (RPCs).
- **Reactive WebSocket Signaling with Authoritative Refetch:** Real-time events from Supabase Realtime serve as signals only. Clients debounce events (300ms window) and execute authoritative queries to prevent split-brain states.
- **Fail-Closed Security Boundaries:** Public profile tables (`public.profiles`) are decoupled from Auth UUIDs, sensitive authentication secrets are segregated in `public.profile_auth_secrets`, and farmer coordinates are restricted to assigned actors.
- **Governed Multi-Party Workflows:** Stateful repair lifecycle transitions (e.g. quote approvals, cancellation reviews, technician verifications, parts holds) require role-specific approval before state changes.

## Layers

**Presentation Layer (UI & Routes):**
- Purpose: Render accessible role-specific views for Farmers, Technicians, and Service Centre Administrators
- Location: `src/routes/` and `src/components/`
- Contains: TanStack Router route definitions, Radix UI widgets, Tailwind-styled dashboards
- Depends on: Hooks (`src/hooks/`), Services (`src/lib/services/`), Auth (`src/lib/auth.ts`)
- Used by: End users in web browser or mobile viewport

**Service & Orchestration Layer:**
- Purpose: Encapsulate domain logic, input sanitization, optimistic concurrency controls, and external service calls
- Location: `src/lib/services/`
- Contains: Business operations for repairs, quotes, inventory, routing, and AI diagnostics
- Depends on: Supabase clients (`src/integrations/supabase/`), External APIs (OSRM, Gemini, Groq)
- Used by: Route components, server handlers, and background tasks

**Data & Integration Layer:**
- Purpose: Data access, authentication propagation, and database contract definitions
- Location: `src/integrations/supabase/`
- Contains: Typed Supabase clients, auth middleware, cron auth helpers, generated database types
- Depends on: `@supabase/supabase-js`
- Used by: Service layer and server route functions

**Database Tier:**
- Purpose: Persistent storage, ACID guarantees, security isolation, and event broadcasting
- Location: `supabase/migrations/`
- Contains: DDL tables, RLS policies, PostgreSQL functions, triggers, and publication bindings
- Depends on: PostgreSQL 17
- Used by: PostgREST and backend Supabase client connections

## Data Flow

### Primary Request Path (Breakdown Report to Technician Assignment)

1. **Intake Entry Point:** Farmer submits breakdown form with symptoms, equipment ID, photos, and location (`src/routes/farmer/report-breakdown.tsx:120`)
2. **Service Mutation:** Client invokes `createRepairRequest()` in `src/lib/services/repair-requests.ts:85`, creating ticket in `REQUESTED` state and inserting dispatch coordinates into `repair_dispatch_locations`
3. **Admin Triage & Algorithmic Matching:** Service Centre admin views unassigned queue (`src/routes/admin/index.tsx`) and triggers candidate matching (`src/lib/matching.ts`)
4. **Assignment:** Admin assigns verified mechanic; ticket transitions to `ASSIGNED` with initial timeline entry
5. **Realtime Broadcast:** Supabase Realtime triggers `useRepairListRealtime` on technician's workbench (`src/hooks/use-repair-realtime.ts:180`), rendering the new dispatch ticket

### Secondary Flow (Technician Quotation & Farmer Approval)

1. **Quote Formulation:** Assigned technician builds itemized quote with labor and catalog parts in `src/routes/technician/job/$id.tsx`
2. **Atomic Submission:** `submitQuote()` (`src/lib/services/quotes.ts`) commits quote line items and updates ticket state to `QUOTE_PENDING`
3. **Farmer Notification & Review:** Farmer receives real-time notification (`src/components/repair-chat.tsx`), views breakdown comparison (`src/components/quote-comparison.tsx`), and approves quote
4. **Transition to Active Repair:** Ticket transitions to `IN_PROGRESS`; stock reservations are locked at parts desk

**State Management:**
- Asynchronous server state cached and invalidated via TanStack Query (`QueryClient`)
- Local form and UI state managed via React Hooks and React Hook Form
- In-memory mock fallback state maintained in `src/lib/tb-store.ts` for offline/demo scenarios

## Key Abstractions

**Repair Request State Machine:**
- Purpose: Represents the end-to-end lifecycle of an equipment breakdown
- States: `REQUESTED` -> `ASSIGNED` -> `QUOTE_PENDING` -> `QUOTE_REVISED` -> `IN_PROGRESS` (with optional `WAITING_FOR_PARTS` / `PARTS_HOLD`) -> `TESTING` -> `COMPLETED` / `CANCELLED`
- Location: `src/lib/services/repair-requests.ts`

**Parts Requisition & Movement Ledger:**
- Purpose: Strict double-entry inventory tracking preventing negative stock or phantom parts usage
- Movement Types: `RECEIVED`, `ISSUED_TO_REPAIR`, `RETURNED`, `ADJUSTMENT`
- Location: `src/lib/services/parts-desk.ts`, `supabase/migrations/20261029100000_phase9_1_parts_pickup.sql`, `supabase/migrations/20261029120000_phase9_2_stock_movement_sales.sql`

**Security Boundary Profile Separation:**
- Purpose: Enforces least-privilege identity access by decoupling auth user IDs from public profile data
- Tables: `public.profiles`, `public.profile_contacts`, `public.profile_auth_secrets`
- Location: `supabase/migrations/20261104100000_profile_security_separation.sql`

## Entry Points

**Web Client Entry Point:**
- Location: `src/router.tsx`, `src/routes/__root.tsx`
- Triggers: User HTTP request to any client URL (`/`, `/farmer/*`, `/technician/*`, `/admin/*`)
- Responsibilities: Mounts QueryClientProvider, renders shell layout, toast provider, and router outlet

**Application Server Entry Point:**
- Location: `src/server.ts`
- Triggers: Nitro HTTP fetch event on Vercel platform
- Responsibilities: Initializes TanStack Start server entry, catches and normalizes h3 500 error bodies, and returns styled HTML error pages

**Health Probe Endpoint:**
- Location: `src/routes/api/health.ts`
- Triggers: Scheduled Vercel Cron (`vercel.json`) or monitoring probe
- Responsibilities: Authenticates bearer token, checks PostgreSQL connectivity, and returns JSON health report

**Visual Defect AI Endpoint:**
- Location: `src/routes/api/assess-visual-defect.ts`
- Triggers: POST request from repair intake flow
- Responsibilities: Validates user JWT, checks claim token under RLS, calls Gemini 3.5 Flash-Lite, and writes diagnostics

## Architectural Constraints

- **Lovable Branch Integrity:** Connected to Lovable editor. Never perform destructive git history operations (`git push --force`, rebase, amend) on published commits (`AGENTS.md`).
- **PostgreSQL RLS Enforcement:** No database reads or writes may bypass Row Level Security except for audited server-side background tasks using `SUPABASE_SERVICE_ROLE_KEY`.
- **Single Realtime Publication:** All tables broadcasting events must be registered explicitly in `supabase_realtime` publication (`20261006100000_phase7_1_realtime_publication_foundation.sql`).
- **Forbidden Server-Only Imports:** TanStack Start uses file-naming conventions (`*.server.ts`) or `@tanstack/react-start/server-only`. Next.js `server-only` is strictly forbidden by ESLint (`eslint.config.js:23`).

## Anti-Patterns

### Bypassing RLS with Direct Client Master Keys
**What happens:** Using `service_role` key in frontend code to bypass permission errors.
**Why it's wrong:** Exposes administrative control to the browser, compromising user data isolation.
**Do this instead:** Use authenticated client `src/integrations/supabase/client.ts` with user JWT and craft appropriate RLS policies.

### In-Memory State as Authoritative Truth
**What happens:** Treating `tb-store.ts` in-memory state as the source of truth across browser reloads.
**Why it's wrong:** Causes silent data divergence between users, especially during multi-party handoffs.
**Do this instead:** Query live Supabase database and treat `tb-store.ts` strictly as an offline or demo fallback.

## Error Handling

**Strategy:** Multi-tier defensive error isolation preventing cascade failures across client and server.

**Patterns:**
- **SSR Failure Recovery:** `normalizeCatastrophicSsrResponse` in `src/server.ts` traps h3 framework errors and renders `src/lib/error-page.ts`.
- **Component Error Boundaries:** `<ComponentErrorBoundary />` (`src/components/component-error-boundary.tsx`) wraps complex components (such as real-time chat and maps) with a localized reload prompt.
- **Optimistic Concurrency Control:** Precondition checks in service mutations (e.g. `technician_id IS NULL` before job acceptance) fail cleanly when concurrent writes collide.

## Cross-Cutting Concerns

**Logging:** Standardized console error logging with captured request context (`src/lib/error-capture.ts`).
**Validation:** Zod schemas for external API payloads and React Hook Form resolvers for UI input.
**Authentication:** Automatic bearer token injection into server functions via `attachSupabaseAuth` middleware (`src/integrations/supabase/auth-attacher.ts`).

---

*Architecture analysis: 2026-11-04*
