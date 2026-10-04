# TerraByte — Project State

## 1. Current Phase

- **Current Phase**: **PHASE 5.4 — IN PROGRESS** (Cancellation Approval)
  - **Step 1 — Database & State Foundation**: **COMPLETE** (Forward migration `20261004100000_phase5_4_cancellation_approval_foundation.sql` manually deployed and verified in Supabase; enum extension, 6 cancellation columns, index, 4 hardened RLS policies, corrected `reset_demo_data()` RPC, TypeScript definitions)
  - **Step 2 — Service Layer & Notification Workflow**: **COMPLETE** (Implemented `requestCancellation`, `approveCancellation`, `rejectCancellation`, hardened `cancelRepairRequest`, equipment integrity guards, multi-party notifications, and notification alert classification)
  - **Step 3 — Farmer Cancellation UI & Dialog**: PENDING
  - **Step 4 — Admin Approval Workbench & Operations Filter**: PENDING
  - **Step 5 — Technician Work-Hold UI & Assignment Termination**: PENDING
  - **Step 6 — End-to-End Verification**: PENDING
- **Previous Completed Phase**: **PHASE 5.3 — COMPLETE** (Notification & Product Communication Polish)
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
- **Phase 5.2 — Demo & Data Hygiene**:
  - **Backend Reset Demo RPC**: Secure `public.reset_demo_data()` PostgreSQL RPC with dual-key authorization (`email` in designated set + `demo_code IS NOT NULL`), atomic transaction, TB-4489 fixture preservation, and deterministic fixture restoration.
  - **Frontend Reset Demo Integration**: `Shell` header button (`RotateCcw`) strictly gated to the 5 designated demo accounts, accessible responsive `AlertDialog` confirmation dialog with loading states, safe error handling, and 7-step post-reset state synchronization.
  - **Farmer Data Isolation & Nagpur Geography**: Isolated active repairs and equipment directly to authenticated profile UUIDs; eliminated legacy Nashik strings across all fixtures.
  - **Completed-Repair & Action-Needed Separation**: Excluded completed/cancelled tickets from active repair card stacks; reserved "Action needed" styling for actionable tickets (`QUOTE_PENDING`, `QUOTE_REVISED`, and unassigned `REQUESTED`).
  - **Loading Performance & Latency Remediation**: Deduplicated startup auth promises, enabled direct profile ID injection, and added database-level active-only query filtering (`{ activeOnly: true }`).
- **Phase 5.3 — Notification & Product Communication Polish**: **COMPLETE** (Steps 1–3 Implemented and Verified)
  - **Quote Revised Communication Aligned**: Updated farmer label in `FARMER_LABEL` to `"Revised Quote Ready"` (replacing `"Quote Being Revised"`), establishing clear alignment with orange "Action needed" status and quote revision workflow.
  - **Completion / Handover Communication Aligned with Persisted Lifecycle**: Unified completion messaging across farmer view (*"Repair Complete & Saved to Service History"*), technician view (*"Repair completed and recorded in equipment service history"*), admin view (*"Repair complete & saved to service history"*), and completion notification copy (*"Repair TB-xxxx has been completed and saved to service history."*). Eliminated contradictory claims of pending handover confirmation when the system auto-commits to service history upon technician completion.
  - **Canonical Demo Technician Notification Fixture Fixed**: Reassigned seed notification fixture `c7fdc083-fce0-4a73-afb8-f63aa84faf2e` to Ramesh Kumar (`t1` / `tech.nagpur@terrabyte.demo` / `00000000-0000-0000-0002-000000000001`) on repair TB-8841 in `supabase/seed.sql` and created forward migration `20261003160000_phase5_3_demo_technician_notification_fix.sql` updating `public.reset_demo_data()`.
  - **Notification State Clearing on User Switch / Sign-Out**: Implemented immediate local state reset (`notifications = []`, error, and popover state) in `Shell` (`src/components/tb.tsx`) on sign-out or user switch, preventing previous user notifications from ever displaying to another user.
  - **Safe Notification Query Limiting & Duplicate Fetch Cleanup**: Bounded initial and polled notification queries to `limit: 25` with newest-first ordering; safely bounded admin SQL queries (`limit: Math.max(limit * 4, 100)`); throttled bell toggle refresh with a 5-second freshness guard to eliminate redundant queries while preserving Supabase Realtime live subscriptions and 15s fallback polling.
  - **Technician Verification Notification**: Implemented `setTechnicianVerification()` in `src/lib/services/technicians.ts` wired to `src/routes/admin/technicians.tsx`. When an admin approves an unverified technician account, dispatches an idempotent notification to that technician (*"Your technician account has been approved by the Service Centre. You can now accept repair jobs."*, deep-link `/technician`).
  - **Technician Started-Work Notification**: Updated `startRepair()` in `src/lib/services/repair-requests.ts` to notify the associated farmer when the technician begins disassembly/physical work (*"Technician started repair work on TB-xxxx."*, deep-link `/farmer/repair/:id`), guarded by an idempotency check against repeated clicks or saves.
  - **New Technician Registration Admin Notification**: Added database trigger `trg_notify_admin_on_technician_registration` on `technician_profiles` insert (migration `20261003170000_phase5_3_technician_registration_notification.sql`) and helper `notifyAdminOnTechnicianRegistration()` in `src/lib/services/technicians.ts`. Notifies Service Centre admins (*"New technician registration: <name> (<workshop>). Pending verification."*, deep-link `/admin/technicians`). Expanded `isActionableServiceCentreNotification()` in `src/lib/services/notifications.ts` to include technician registration patterns in admin notification counts and queues.
  - **Notification Copy Standardization**: Audited and standardized all notification copy across quotes, repair requests, and technician operations. Enforced consistent sentence casing, concise action-oriented tone, and proper ending punctuation across all system notifications.
  - **Enhanced Notification Popover Visual Hierarchy**: Redesigned Shell bell popover in `src/components/tb.tsx` with semantic category pill badges and icons (`Breakdown`, `Quote`, `Parts`, `Testing`, `Repair`, `Account`, `Assignment`, `Alert`, `Notice`), distinct unread indicator dot with subtle focus ring, unread background highlight (`bg-primary/[0.04]`), and actionable "View details" cue, preserving all existing interactions.

- **Phase 5.4 — Cancellation Approval**: **IN PROGRESS** (Steps 1 & 2 Implemented)
  - **Repair Status Enum Extended**: Added `CANCELLATION_REQUESTED` to `public.repair_status` PostgreSQL enum before `CANCELLED`.
  - **Cancellation Tracking Columns**: Added `cancellation_reason` (text), `cancellation_note` (text), `cancellation_requested_by` (uuid), `cancellation_requested_at` (timestamptz), `cancellation_previous_status` (public.repair_status), and `cancellation_admin_response` (text) to `public.repair_requests` with a partial index on status `CANCELLATION_REQUESTED`.
  - **RLS UPDATE Policies Hardened**: Implemented 4 purpose-driven `UPDATE` policies on `public.repair_requests` preventing direct dangerous mutations. Farmers may directly cancel ONLY unassigned `REQUESTED` repairs (verified via `USING` on `OLD` stored row); assigned/in-flight repairs must transition via `CANCELLATION_REQUESTED`; tickets under review are locked (`USING (status != 'CANCELLATION_REQUESTED')`); technicians are strictly prohibited from cancelling or requesting cancellation; and administrative resolution authority is preserved.
  - **Demo Reset Function Updated**: Enhanced `public.reset_demo_data()` in forward migration `20261004100000_phase5_4_cancellation_approval_foundation.sql` to nullify all 6 cancellation columns on canonical demo repairs while strictly preserving their Phase 5.2 baseline statuses (`TB-8841` $\rightarrow$ `WAITING_FOR_PARTS`, `TB-8902` $\rightarrow$ `QUOTE_PENDING`, `TB-8898` $\rightarrow$ `REQUESTED`, `TB-4489` $\rightarrow$ `QUOTE_REVISED`), keeping real user accounts (such as `Ankit Chamke`) completely untouched.
  - **Cancellation State Machine & Service Layer**: Implemented `requestCancellation()`, `approveCancellation()`, `rejectCancellation()`, and hardened `cancelRepairRequest()` in `src/lib/services/repair-requests.ts`. Enforced strict direct cancellation isolation (unassigned `REQUESTED` only), active repair governed review, equipment integrity guards, dual-party notification dispatches, and category pattern classification in `src/lib/services/notifications.ts`.
  - **Type Synchronization**: Synchronized TypeScript definitions in `src/integrations/supabase/types.ts`, `src/lib/tb-store.ts`, `src/components/tb.tsx`, and `src/lib/services/repair-requests.ts`.
  - **Remote Deployment Status**: Supabase CLI push is blocked by `DbPushMissingLocalError` due to Lovable legacy migration entries (`20260930000001`–`20260930000008`). Per project rules against history rewrites, history is not repaired. Migration is prepared for execution via the Supabase Dashboard SQL Editor.

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

- The five core architecture documents (`PROJECT_STATE.md`, `IMPLEMENTATION_PLAN.md`, `APP_FLOW.md`, `TESTING.md`, `TRD.md`) are synchronized at this Phase 5.4 Step 2 checkpoint.
- **Phase 5.4 is IN PROGRESS**. Step 1 (Database Foundation) and Step 2 (State Machine & Service Layer) are implemented and verified with clean builds (`npm run build`). Verification tests `P5.4-01` through `P5.4-12` are tracked for manual verification.
- Working tree is verified on branch `phase-5`.

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
7. **Realtime Scope Boundary**: Realtime notification delivery in Phase 5.3 is strictly scoped to the existing Supabase Realtime channel (`postgres_changes` on `public.notifications`) and 15-second background polling fallback. Broader multi-user interactive realtime state synchronization across boards, active forms, and technician assignments is explicitly deferred to **Phase 7 (Realtime Sync & Production Hardening)**.

