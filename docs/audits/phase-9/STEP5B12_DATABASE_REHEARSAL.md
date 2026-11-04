# TerraByte — Step 5B.12: Database Migration Rehearsal Report
**Document Version:** `1.0 (PostgreSQL 17.6 Drill)`  
**Date:** `2026-11-04`  
**Test Environment:** Isolated PostgreSQL 17.6 (`x86_64-windows`) on `127.0.0.1:5433`  
**Target Drill Database:** `terabyte_clean_restore_drill` (Clean production restore baseline)  
**Production Gate Status:** **`UNAUTHORIZED / BLOCKED — ZERO PRODUCTION SQL EXECUTION AUTHORIZED`**

---

## 1. Executive Summary

As required by Step 5B.12 Workstream D, a complete, isolated database migration rehearsal was conducted on local PostgreSQL 17.6 (`127.0.0.1:5433`) against `terabyte_clean_restore_drill`.

The rehearsal verified:
1. Sequential execution of the three forward Phase 9 migrations (`20261104110000`, `20261104120000`, `20261104130000`) comprising all 55 discrete SQL statements.
2. Complete re-run idempotency without errors or catalog drift.
3. Post-execution PostgreSQL catalog verification across indexes, triggers, functions, explicit `search_path`, privilege ACLs, publication membership, and RLS policies.
4. Total isolation: Zero connection attempts or queries against Supabase remote production (`hwdrypkvszwrcraujctw`).

---

## 2. Migration Rehearsal Execution Log

### 2.1 Pass 1: Sequential Forward Application

| Migration Letter | Filename | Objects Created / Modified | Execution Duration | Exit Code | Status |
| :---: | :--- | :--- | :---: | :---: | :---: |
| **Migration A** | `20261104110000_complete_phase9_parts_desk_rpcs.sql` | 2 Indexes (`idx_sc_sales_sold_at`, `idx_sc_stock_audit_movement`), 5 RPC Functions, Table Grants, RLS Policies | **53.6 ms** | `0` | **SUCCESS** |
| **Migration B** | `20261104120000_complete_phase9_realtime_and_eta.sql` | 1 Index (`idx_sc_part_requests_estimated_arrival`), 1 Trigger (`trg_protect_technician_part_request_fields`), 3 RPC Functions, Realtime Publications | **66.6 ms** | `0` | **SUCCESS** |
| **Migration C** | `20261104130000_complete_phase5_3_technician_registration_notification.sql` | 1 Trigger Function, 1 Trigger (`trg_notify_admin_on_technician_registration`), Privilege Grants | **50.4 ms** | `0` | **SUCCESS** |
| **Total Pass 1** | **All 3 Forward Migrations** | **All 55 Discrete SQL Statements Applied** | **170.6 ms** | `0` | **100% PASS** |

### 2.2 Pass 2: Rerun Idempotency Verification

Each migration script was executed a second time immediately following Pass 1 to prove that rerun safety constructs (`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, `IF NOT EXISTS` publication additions) prevent schema collisions.

| Migration Letter | Filename | Rerun Behavior | Execution Duration | Exit Code | Status |
| :---: | :--- | :--- | :---: | :---: | :---: |
| **Migration A** | `20261104110000_complete_phase9_parts_desk_rpcs.sql` | Clean no-op / replace | **52.9 ms** | `0` | **SUCCESS** |
| **Migration B** | `20261104120000_complete_phase9_realtime_and_eta.sql` | Clean no-op / replace | **175.6 ms** | `0` | **SUCCESS** |
| **Migration C** | `20261104130000_complete_phase5_3_technician_registration_notification.sql` | Clean no-op / replace | **49.0 ms** | `0` | **SUCCESS** |
| **Total Pass 2** | **All 3 Forward Migrations** | **Complete Idempotent Re-execution** | **277.5 ms** | `0` | **100% IDEMPOTENT** |

---

## 3. PostgreSQL 17.6 Catalog Verification Results

Following Pass 2, direct SQL queries inspected PostgreSQL catalog tables (`pg_index`, `pg_trigger`, `pg_proc`, `pg_publication_tables`, `pg_policies`).

### 3.1 Indexes Verification (`pg_index`)

```sql
SELECT c.relname, i.indisvalid, i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'idx_sc_sales_sold_at',
    'idx_sc_stock_audit_movement',
    'idx_sc_part_requests_estimated_arrival'
  )
ORDER BY c.relname;
```

**Results:**
- `idx_sc_part_requests_estimated_arrival`: `indisvalid = true`, `indisready = true`
- `idx_sc_sales_sold_at`: `indisvalid = true`, `indisready = true`
- `idx_sc_stock_audit_movement`: `indisvalid = true`, `indisready = true`
- **Result:** **3 / 3 forward indexes valid and ready (100%)**.

### 3.2 Triggers Verification (`pg_trigger`)

```sql
SELECT tgname, relname, tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND tgname IN (
    'trg_protect_technician_part_request_fields',
    'trg_notify_admin_on_technician_registration'
  )
ORDER BY tgname;
```

**Results:**
- `trg_notify_admin_on_technician_registration` on `technician_profiles`: `tgenabled = 'O'` (Origin and local)
- `trg_protect_technician_part_request_fields` on `service_centre_part_requests`: `tgenabled = 'O'` (Origin and local)
- **Result:** **2 / 2 triggers active and operational (100%)**.

### 3.3 Function Security & `search_path` (`pg_proc`)

```sql
SELECT p.proname, p.prosecdef, p.provolatile,
       COALESCE(array_to_string(p.proconfig, ','), 'NONE') as search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic',
    'trg_enforce_technician_part_request_fields',
    'notify_admin_on_technician_registration'
  )
ORDER BY p.proname;
```

**Results:**
| Function Name | `prosecdef` | Volatility | `search_path` Config | Status |
| :--- | :---: | :---: | :--- | :---: |
| `adjust_service_centre_part_stock` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `confirm_service_centre_part_handoff` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `create_quote_atomic` | `true` | `VOLATILE` | `search_path=public, pg_temp` | **SECURE** |
| `notify_admin_on_technician_registration` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `receive_service_centre_stock` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `request_service_centre_part` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `return_service_centre_part` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
| `revise_quote_atomic` | `true` | `VOLATILE` | `search_path=public, pg_temp` | **SECURE** |
| `trg_enforce_technician_part_request_fields` | `true` | `VOLATILE` | `search_path=public, pg_temp` | **SECURE** |
| `update_service_centre_part_request_eta` | `true` | `VOLATILE` | `search_path=public, auth, pg_temp` | **SECURE** |
- **Result:** **10 / 10 functions are SECURITY DEFINER with explicit `search_path` pinning including `pg_temp`**.

### 3.4 Function Privilege ACL Verification (`has_function_privilege`)

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_service_centre_part_handoff',
    'adjust_service_centre_part_stock',
    'request_service_centre_part',
    'receive_service_centre_stock',
    'return_service_centre_part',
    'update_service_centre_part_request_eta',
    'create_quote_atomic',
    'revise_quote_atomic',
    'notify_admin_on_technician_registration'
  )
ORDER BY p.proname;
```

**Results:**
- For all 9 executable functions:
  - `anon_exec = false` (Strict fail-closed: anonymous unauthenticated requests are rejected).
  - `auth_exec = true` (Granted to authenticated callers and service_role).
- **Result:** **9 / 9 functions enforce privilege isolation (100%)**.

### 3.5 Supabase Realtime Publication Membership (`pg_publication_tables`)

```sql
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN (
    'service_centre_part_requests',
    'service_centre_parts',
    'service_centre_part_sales',
    'service_centre_stock_audit',
    'quote_items'
  )
ORDER BY tablename;
```

**Results:**
- `quote_items`: Present in `supabase_realtime`
- `service_centre_part_requests`: Present in `supabase_realtime`
- `service_centre_part_sales`: Present in `supabase_realtime`
- `service_centre_parts`: Present in `supabase_realtime`
- `service_centre_stock_audit`: Present in `supabase_realtime`
- **Result:** **5 / 5 target tables registered in realtime publication (100%)**.

### 3.6 Row Level Security (RLS) Policies

All 10 RLS policies across the 4 Service Centre tables are active and enforcing role-based permissions:
1. `service_centre_parts`: Technicians and admins can view active parts; admins can manage stock.
2. `service_centre_part_requests`: Technicians can create and view requests for assigned repairs; admins can manage and fulfill.
3. `service_centre_part_sales`: Admins can record and view parts sales.
4. `service_centre_stock_audit`: Admins can view audit movement records.

---

## 4. Phase 11 Migration Isolation

During this drill, forward migrations were restricted strictly to Phase 9 (`20261104110000`, `20261104120000`, `20261104130000`).  
Phase 11 migrations (`20261103120000_phase11_visual_diagnostics.sql`, `20261104100000_profile_security_separation.sql`) were **deliberately excluded** from the rehearsal, confirming that Phase 9 has zero runtime dependency on unapplied Phase 11 schemas.

---

## 5. Staging Readiness Verdict

The forward migration package is **100% verified, reproducible, and ready for staging deployment rehearsal**.

Production deployment remains **`UNAUTHORIZED / BLOCKED`**.
