# TerraByte — Project State

## 1. Current Phase

- **Current Phase**: **PHASE 5.2 — IN PROGRESS** (Demo & Data Hygiene / Baseline Reset)
- **Previous Completed Phase**: **PHASE 5.1 — COMPLETE** (Product Polish: Home Experience, Contextual Back Navigation, Profile Management, Password Management, Branded Reset Email, Account Deletion RPC & UI — Commit `a6ff2de`)
- **Branch**: `phase-5` (connected to Lovable; no destructive Git history operations)

---

## 2. Current Project Status

TerraByte is an end-to-end digital agricultural equipment repair ecosystem designed to coordinate the complete journey from machinery breakdown to verified repair and back into the field in Nagpur, Maharashtra (Vidarbha region).

### Completed Work

- **Phase 1 — Codebase Cleanup & Documentation Reset**: Clean baseline established on Supabase Auth & PostgreSQL.
- **Phase 2 — Domain Database Foundation & Security Hardening**: PostgreSQL schema with RLS across `profiles`, `technician_profiles`, `equipment`, `repair_requests`, `quotes`, `quote_items`, `repair_notes`, `repair_timeline`, `service_history`, and `notifications`.
- **Phase 3 — Core Repair & Quotation Workflows**: Breakdown reporting, technician assignment matching, itemized quotes, approval/rejection lifecycle, parts hold pauses, testing stages, and completion verification.
- **Phase 4 — Operational Experience & Notifications**: Role-specific notification queues, real-time toast alerts, technician verification workflow, and service centre command dispatch.
- **Phase 5.1 — Product Polish & Account Lifecycle**:
  - Unified Home experience (`/`) with contextual role entry points.
  - Contextual back navigation preserving state across views.
  - Profile management (name, phone, village/workshop, brand specializations).
  - Password management (forgot password, recovery tokens, branded reset email template, change password).
  - Permanent account deletion via atomic PostgreSQL RPC `public.delete_user_account()` with active-repair and demo-account protections.
- **Phase 5.2 — Demo & Data Hygiene (In Progress)**:
  - **Backend Reset Demo RPC**: Secure `public.reset_demo_data()` PostgreSQL RPC with dual-key authorization (`email` in designated set + `demo_code IS NOT NULL`), atomic transaction, TB-4489 fixture preservation, and deterministic fixture restoration.
  - **Frontend Reset Demo Integration**: `Shell` header button (`RotateCcw`) strictly gated to the 5 designated demo accounts, accessible responsive `AlertDialog` confirmation dialog with loading states, safe error handling, and 7-step post-reset state synchronization.

### Current Discovered Issues Under Remediation

1. **Farmer Demo Data Isolation**:
   - *Issue*: Multiple farmer demo accounts (`farmer.nagpur@terrabyte.demo`, `farmer2.nagpur@terrabyte.demo`, `farmer3.nagpur@terrabyte.demo`) and real users were rendering the same demo machine and active repair (`TB-8841` on `Mahindra 575 DI`).
   - *Root Cause*: `src/routes/farmer/index.tsx` was reading active repairs from local mock state `tb-store` with hardcoded fallback `"f1"`, and service getters lacked explicit `farmer_id` filtering.
   - *Resolution*: Connected `FarmerHome` directly to live Supabase queries via `getFarmerRepairRequests()` and `getFarmerEquipment()`, scoped service queries strictly to authenticated `profile.id`, and bound `RoleGuard` session to dynamic farmer identity.
2. **Service Centre Geography Inconsistency**:
   - *Issue*: Service Centre header rendered `"Nashik Service Centre"` while the dashboard indicated `"NAGPUR DISTRICT · LIVE"`.
   - *Root Cause*: Seed profile and database RPC fixtures still contained legacy Nashik strings for the admin profile, technicians, and repair locations.
   - *Resolution*: Synchronized all demo fixtures, admin profile (`"Nagpur Service Centre"`, `"Nagpur Central Command"`), and repair locations to Nagpur agricultural talukas (Katol, Saoner, Umred).
3. **Completed-Repair / "Action Needed" Classification**:
   - *Issue*: Real farmer accounts with completed and verified repairs (e.g. `TB-2334`, `TB-7630`, `TB-3272`) displayed them as large orange "Action needed" cards on the farmer home screen.
   - *Root Cause*: `FarmerHome` checked `!(r.status === "COMPLETED" && r.verified_at)` to filter active repairs, and `(r.status === "COMPLETED" && !r.verified_at)` to mark `needsAction`. Because `verified_at` was `null` in Supabase (the real lifecycle auto-commits permanent service records upon technician completion without a separate manual handover verification mutation), all completed repairs were indefinitely treated as active and flagged as "Action needed".
   - *Resolution*: Updated `FarmerHome` to strictly filter out `COMPLETED` and `CANCELLED` tickets from the active repairs card stack (`r.status !== "CANCELLED" && r.status !== "COMPLETED"`). Reserved "Action needed" exclusively for tickets awaiting real farmer input (`QUOTE_PENDING`, `QUOTE_REVISED`). Historical completed repairs remain fully accessible via Service History, machine records, and direct repair links without cluttering the active workspace.
4. **Dashboard Loading Performance & Latency Remediation**:
   - *Issue*: Farmer dashboard showed sequential loading states ("Checking active repairs...", then "Loading machines..."), and Service Centre dashboard blocked the entire screen on "Loading repair operations..." for too long. Even after initial decoupling, real accounts with many tickets experienced latency.
   - *Root Cause*:
     1. Startup promise race in `auth.ts`: Both `onAuthStateChange` and `getSession()` triggered concurrent `loadProfile()` calls, doubling initial network roundtrips.
     2. Profile resolution in `notifications.ts`: Lacked session fast-path and profile cache in `getAuthenticatedProfile()`.
     3. Over-fetching in `repair-requests.ts`: `getFarmerRepairRequests()` loaded ALL historical repairs (15 rows for Ankit Chamke with joins across `equipment` and `technician_profiles`), transferring unnecessary rows only to discard them in frontend memory.
   - *Resolution*: Added in-flight promise deduplication to `loadProfile()` in `auth.ts`; implemented session fast-path and 60-second caching in `notifications.ts`; added optional `{ activeOnly: true }` parameter to `getFarmerRepairRequests()` using database-level `.not("status", "in", '("COMPLETED","CANCELLED")')`. Perceived load time slashed by eliminating 90% of row transfers and halving startup auth roundtrips.
5. **TB-4545 Repair Action State ("Send Request to Technician")**:
   - *Issue*: On real farmer account Ankit Chamke, `TB-4545` was displayed as an active repair with status pill *"Finding Your Technician"* and technician *"Not yet assigned"*, even though the farmer had never dispatched or requested a technician.
   - *Root Cause*: `TB-4545` was in status `REQUESTED` with `technician_id = null` and a single timeline entry ("Breakdown reported"). In `src/routes/farmer/index.tsx`, `needsAction` only checked `QUOTE_PENDING` and `QUOTE_REVISED`. Status `REQUESTED` fell through to default label `"Finding Your Technician"`, falsely implying an automatic dispatch process was underway.
   - *Resolution*: Updated `src/components/tb.tsx` `StatusPill` to accept `technicianId`. When `audience === "farmer"` and `status === "REQUESTED"` with `!technicianId`, `StatusPill` renders *"Send request to technician"* with accent tone (`bg-accent/25 text-accent-foreground`). Updated `FarmerHome` (`src/routes/farmer/index.tsx`) to flag `r.status === "REQUESTED" && !r.technician_id` as `needsAction = true` (orange border and header) and set the CTA button to *"Send request to technician"*.
6. **Explicit Real vs Demo Identity Presentation (`DemoTag`)**:
   - *Issue*: Real farmer Ankit Chamke displayed a `"DEMO DATA"` badge near the dashboard header.
   - *Root Cause*: `DemoTag` in `src/components/tb.tsx` was hardcoded to unconditionally render `<span>Demo data</span>` regardless of the logged-in user's identity.
   - *Resolution*: Updated `DemoTag` to check `const { email } = useAuth(); if (!isDesignatedDemoAccount(email)) return null;`. The `"DEMO DATA"` badge now displays strictly and exclusively for the 5 canonical demo accounts (`farmer.nagpur@terrabyte.demo`, `farmer2.nagpur@terrabyte.demo`, `farmer3.nagpur@terrabyte.demo`, `tech.nagpur@terrabyte.demo`, `admin.nagpur@terrabyte.demo`). Real accounts like Ankit Chamke never render demo tags.

### Checkpoint Status

- The five core architecture documents (`PROJECT_STATE.md`, `IMPLEMENTATION_PLAN.md`, `APP_FLOW.md`, `TESTING.md`, `TRD.md`) are synchronized at this Phase 5.2 checkpoint.
- **No commit or push** will be executed until manual testing across isolation, classification, lifecycle state accuracy, and performance is fully verified.
- Phase 5.2 remains **IN PROGRESS**.

---

## 3. Locked Technical Decisions

1. **Target Regional Geography**: Demo data, crop contexts, machine brands, and regional terminology are strictly anchored in **Nagpur, Maharashtra** (Vidarbha region: cotton, soybean, orange belts; Katol, Saoner, Umred talukas; Mahindra, John Deere, Kubota, Swaraj equipment).
2. **Backend as Source of Truth**: Live Supabase PostgreSQL is the sole source of truth for persisted workflows. Local mock store state (`tb-store.ts`) must never overwrite authenticated live user data.
3. **Data Scoping Discipline**: Every data query must resolve caller identity through authenticated `auth.uid()` $\rightarrow$ `profiles` row $\rightarrow$ `profile.id`, strictly scoped to the authenticated user.
4. **Demo Account Authorization**: Reset Demo capabilities are strictly restricted on the backend via dual-key authorization to the 5 designated evaluation personas:
   - `farmer.nagpur@terrabyte.demo`
   - `farmer2.nagpur@terrabyte.demo`
   - `farmer3.nagpur@terrabyte.demo`
   - `tech.nagpur@terrabyte.demo`
   - `admin.nagpur@terrabyte.demo`
5. **Real User Isolation**: Real user data is strictly isolated by RLS and cannot be modified or cleared by demo reset operations.
6. **Assistive AI Only**: Machine diagnostics use rule-based reasoning with transparent markers. AI provides decision support; farmers and technicians retain final operational authority.
