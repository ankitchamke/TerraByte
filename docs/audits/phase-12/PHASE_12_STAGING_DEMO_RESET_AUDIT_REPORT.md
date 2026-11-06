# TerraByte — Phase 12 Staging Demo Reset Audit Report

## 1. Executive Summary

This report documents the investigation, remediation, and single controlled execution of `public.reset_demo_data()` against the dedicated staging environment (`ubqgvhcfmrvnmrbllcom`) on branch `phase-12`.

Production (`hwdrypkvszwrcraujctw`) was strictly air-gapped and untouched throughout the entire procedure.

---

## 2. Root Cause Analysis

Two primary bugs prevented demo reset from resetting staging database fixtures:

1. **Dual-Key Authorization Disconnect in `reset_demo_data()`**:
   The deployed definition of `public.reset_demo_data()` in staging strictly checked:
   - `auth.uid() IN ('00000000-0000-0000-0000-000000000001', '...0004', '...0005')`
   - `auth.users.email IN ('farmer.nagpur@terrabyte.demo', 'tech.nagpur@terrabyte.demo', 'admin.nagpur@terrabyte.demo')`
   However, the staging database fixtures were owned by the synthetic staging accounts (`farmer.staging@terrabyte.app`, `tech.staging@terrabyte.app`, `admin.staging@terrabyte.app`) with auth UUIDs `00000000-0000-0000-0001-000000000001`, `...0002-...0001`, `...0003-...0001`. Attempting to execute the RPC as the staging farmer raised error `42501 Unauthorized`.

2. **Frontend Error Swallowing in `src/components/tb.tsx`**:
   `handleExecuteReset` had an inner `try/catch` wrapping `await resetDemoData()`. When the RPC rejected the call with `42501`, the error was caught and suppressed with `console.warn`. The UI then proceeded to clear browser `localStorage` and display `toast.success("Demo environment reset to baseline.")`, falsely indicating success while the database remained unchanged.

---

## 3. Modified Files and Migration

### A. Source Files Modified
- **`src/components/tb.tsx`**:
  - Removed nested error-swallowing behavior.
  - Awaits `resetDemoData()` and verifies `rpcResult.success === true` before updating client state.
  - On failure, aborts reset flow, keeps confirmation dialog open, leaves local storage intact, and presents an error toast.
- **`src/routes/login.tsx` & `src/routes/index.tsx`**:
  - Restored environment-aware Quick Demo buttons pointing to staging identities (`farmer.staging@terrabyte.app`, etc.) when `ubqgvhcfmrvnmrbllcom` is active, and canonical Nagpur demo accounts when in production.

### B. Forward Migration
- **Filename**: `supabase/migrations/20261106153000_phase12_staging_reset_demo_rpc_pair_auth.sql`
- **Application Target**: Staging database (`ubqgvhcfmrvnmrbllcom`) only.
- **Security Logic**: Implements exact caller ID-and-email pair matching:
  - `(v_caller_id = '00000000-0000-0000-0001-000000000001' AND v_caller_email = 'farmer.staging@terrabyte.app')`
  - `(v_caller_id = '00000000-0000-0000-0002-000000000001' AND v_caller_email = 'tech.staging@terrabyte.app')`
  - `(v_caller_id = '00000000-0000-0000-0003-000000000001' AND v_caller_email = 'admin.staging@terrabyte.app')`
  - `(v_caller_id = '00000000-0000-0000-0000-000000000001' AND v_caller_email = 'farmer.nagpur@terrabyte.demo')`
  - `(v_caller_id = '00000000-0000-0000-0000-000000000004' AND v_caller_email = 'tech.nagpur@terrabyte.demo')`
  - `(v_caller_id = '00000000-0000-0000-0000-000000000005' AND v_caller_email = 'admin.nagpur@terrabyte.demo')`
- Strictly disallows cross-pairing of IDs and arbitrary accounts. Preserves dual-key `demo_code` check and `SECURITY DEFINER` posture.

---

## 4. Staging Identity Mapping

| Role | Staging Email | Auth UID | Profile ID | Full Name | Demo Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Farmer** | `farmer.staging@terrabyte.app` | `00000000-0000-0000-0001-000000000001` | `00000000-0000-0000-0001-000000000001` | Devdas Gaikwad | `FARMER-DEMO-01` |
| **Technician** | `tech.staging@terrabyte.app` | `00000000-0000-0000-0002-000000000001` | `00000000-0000-0000-0002-000000000001` | Santosh Kale | `TECH-DEMO-01` |
| **Admin** | `admin.staging@terrabyte.app` | `00000000-0000-0000-0003-000000000001` | `00000000-0000-0000-0003-000000000001` | Rahul Patil | `ADMIN-DEMO-01` |

---

## 5. Controlled Execution Record

- **Operation**: `public.reset_demo_data()`
- **Caller**: Authenticated staging farmer `farmer.staging@terrabyte.app`
- **Method**: Standard client invocation via `supabase.rpc("reset_demo_data")` (zero parameters, authenticated JWT)
- **Execution Count**: Exactly 1
- **Duration**: 781 ms
- **Target Project**: `ubqgvhcfmrvnmrbllcom` (Staging)

### Actual RPC Response
```json
{
  "message": "Demo baseline successfully and deterministically restored",
  "success": true,
  "timestamp": "2026-11-06T10:02:05.4664+00:00",
  "equipment_reset": 3,
  "repairs_deleted": 2,
  "equipment_deleted": 2,
  "notifications_deleted": 1,
  "service_history_deleted": 0
}
```

---

## 6. Before / After Staging Record Counts

| Entity | Pre-Reset State | Post-Reset Baseline | Verification Status |
| :--- | :--- | :--- | :--- |
| **Farmer Repairs** | 2 (`JOB-2026-0001`, `TB-1565`) | **0** (Clean slate, zero resurrection) | Verified |
| **Farmer Equipment** | 2 non-canonical machines (`EQ-JD-01`, `EQ-MH-02`) | **3 canonical machines** (`e1`, `e2`, `e3` all Operational) | Verified |
| **Service Centre Parts** | 10 parts (5 legacy + 5 canonical) | **5 canonical baseline parts** (Stock: 3, 8, 2, 5, 1) | Verified |
| **Technician Status** | Operational | `is_available: true, is_verified: true` | Verified |
| **Notifications** | 1 unread notification | **0** | Verified |
| **Unrelated Accounts** | 0 real accounts | **0** (Untouched) | Verified |

### Restored Canonical Baseline Equipment
1. `00000000-0000-0000-0010-000000000001`: Mahindra 575 DI (Tractor) — Operational [demo_code: `e1`, 1,240 hrs]
2. `00000000-0000-0000-0010-000000000002`: VST Shakti 130 DI (Power Tiller) — Operational [demo_code: `e2`, 3,120 hrs]
3. `00000000-0000-0000-0010-000000000003`: John Deere W70 (Harvester) — Operational [demo_code: `e3`, 890 hrs]

### Restored Canonical Baseline Inventory
1. `0433171`: Fuel Injector Nozzle Set — Stock: 3, Location: Depot Shelf A-02
2. `005556958R1`: Inline Fuel Filter — Stock: 8, Location: Depot Shelf A-03
3. `AL120788`: Lift Cylinder Seal Kit — Stock: 2, Location: Depot Shelf B-01
4. `HY-GARD-15W30`: Hydraulic Oil 15W-30 — Stock: 5, Location: Depot Drum Rack B-04
5. `26243171`: Starter Motor Assembly — Stock: 1, Location: Depot Shelf C-01

---

## 7. Verification & Safety Evidence

- **Automated Tests**: 171/171 passing (`node --test tests/*.test.mjs`). No tests invoke the destructive RPC.
- **Build Verification**: Clean production client and SSR Nitro server build (`npm run build`).
- **Production Isolation**: Production database `hwdrypkvszwrcraujctw` had zero connections and zero queries executed.
- **Git State**: Preserved all uncommitted working tree changes on branch `phase-12`. Zero commits, zero pushes, zero deployments.
