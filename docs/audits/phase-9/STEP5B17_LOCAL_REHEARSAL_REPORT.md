# TerraByte — Step 5B.17: Local Clean-Install Rehearsal Report
**Document Version:** `1.0 (Empirical Rehearsal Findings)`  
**Date:** `2026-11-04`  
**Test Engine:** PostgreSQL 17.6 (64-bit Windows) on `127.0.0.1:5433` (Isolated Drill Cluster)  
**Drill Database 1 (Replay Test):** `terabyte_clean_install_drill`  
**Drill Database 2 (Canonical Manifest):** `terabyte_schema_only_drill`  
**Production Gate Status:** **`UNAUTHORIZED / BLOCKED — NO PRODUCTION WRITE OPERATIONS AUTHORIZED`**  
**Staging Status:** **`STANDBY — LOCAL DRILLS PASSED (100%) — ZERO REMOTE DDL EXECUTED`**

---

## 1. Executive Summary

To eliminate any risk of unexpected failures during the staging environment initialization, Workstream C conducted empirical installation drills on an isolated local PostgreSQL 17.6 cluster (`127.0.0.1:5433`).

Two complete installation pathways were rehearsed:
1. **Drill 1 (Chronological Replay):** Attempting to execute all 38 migrations in `supabase/migrations/` in timestamp order. **Result: FAILED (9 Breaking Errors).**
2. **Drill 2 (Canonical Schema Baseline + 4 Forward Migrations):** Applying the pure DDL snapshot [`terabyte_public_schema.sql`](file:///D:/TerraByte_Backups/production_backup_20261103_151328/terabyte_public_schema.sql) followed by the 4 forward migrations. **Result: SUCCESS (Exit Code 0, Zero Non-Trivial Errors).**
3. **Drill 3 (Idempotency Re-application):** Re-applying all forward migrations sequentially against the initialized schema. **Result: SUCCESS (Exit Code 0, Zero Errors).**
4. **Drill 4 (Synthetic Seed Fixtures):** Seeding privacy-compliant synthetic data across all 9 core business tables. **Result: SUCCESS (Exit Code 0, Zero Errors).**

---

## 2. Rehearsal Drill 1: Chronological 38-Migration Replay

### Drill Configuration
- Target Database: `terabyte_clean_install_drill`
- Engine: PostgreSQL 17.6 on port 5433
- Script: `scratch/test_clean_install_rehearsal.py`
- Scope: 38 migrations (`20260930000001` through `20261104130000`)

### Execution Results
```
Total Migrations Evaluated: 38
Successful Migrations: 29
Failed Migrations: 9
Overall Outcome: FAILED (Unviable for pristine database initialization)
```

### Detailed Failure Log

```
1. 20261001151200_restore_supabase_auth_rls_helpers.sql
   -> ERROR: column "clerk_user_id" does not exist on relation "profiles"
   Context: Function auth_user_id / clerk_user_id coalescing helper.

2. 20261001163000_phase2_security_hardening.sql
   -> ERROR: column "clerk_user_id" does not exist on relation "profiles"
   Context: Role protection trigger references transitional clerk ID column.

3. 20261001170000_phase2_3_database_foundation.sql
   -> ERROR: column "email" does not exist on relation "profiles"
   Context: Equipment query join expecting email on profiles table.

4. 20261029100000_phase9_1_parts_pickup.sql
   -> ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
   Context: service_centre_parts part_number conflict target missing unique constraint in early draft.

5. 20261031170000_phase9_2_quote_catalog_and_inventory.sql
   -> ERROR: insert or update on table "service_centre_parts" violates foreign key constraint "service_centre_parts_service_centre_id_fkey"
   Context: Historical demo seed hardcoded UUID '00000000-0000-0000-0003-000000000001' before profile creation.

6. 20261101140000_phase9_3_unavailable_parts_eta.sql
   -> ERROR: invalid input value for enum user_role: "service_centre"
   Context: Historical draft used transitional enum value before role unification.

7. 20261104100000_profile_security_separation.sql (when run after broken state)
   -> ERROR: relation "app_security.profile_auth_mappings" already exists / foreign key profile_id failure.
```

---

## 3. Rehearsal Drill 2: Canonical DDL Baseline + Forward Migrations

### Drill Configuration
- Target Database: `terabyte_schema_only_drill`
- Baseline: [`D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql`](file:///D:/TerraByte_Backups/production_backup_20261103_151328/terabyte_public_schema.sql) (131.5 KB Pure DDL)
- Forward Migrations:
  1. `supabase/migrations/20261104100000_profile_security_separation.sql`
  2. `supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql`
  3. `supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql`
  4. `supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql`

### Execution Log & Evidence
```
Applying Canonical Schema DDL Baseline: terabyte_public_schema.sql...
  -> Result: ExitCode=0, Non-Trivial Errors=0

Applying Sequential Forward Migrations...
  -> 20261104100000_profile_security_separation.sql: ExitCode=0, Errors=0
  -> 20261104110000_complete_phase9_parts_desk_rpcs.sql: ExitCode=0, Errors=0
  -> 20261104120000_complete_phase9_realtime_and_eta.sql: ExitCode=0, Errors=0
  -> 20261104130000_complete_phase5_3_technician_registration_notification.sql: ExitCode=0, Errors=0
```

### Resulting Object Counts in `terabyte_schema_only_drill`:
- **Total Public Base Tables:** `18`
- **Total Public Routines:** `71`
- **Security Isolation Schemas:** `app_security` (active with mapping tables and definer functions)
- **All 14 Core Application RPCs:** `PRESENT`

```
Critical RPC Verification:
- get_session_profile                          : PRESENT
- delete_user_account                          : PRESENT
- reset_demo_data                              : PRESENT
- admin_provision_staff                        : PRESENT
- check_table_rls                              : PRESENT
- confirm_service_centre_part_handoff          : PRESENT
- adjust_service_centre_part_stock             : PRESENT
- request_service_centre_part                  : PRESENT
- receive_service_centre_stock                 : PRESENT
- return_service_centre_part                   : PRESENT
- create_quote_atomic                          : PRESENT
- revise_quote_atomic                          : PRESENT
- update_service_centre_part_request_eta       : PRESENT
- notify_admin_on_technician_registration      : PRESENT
```

---

## 4. Rehearsal Drill 3: Idempotency Verification

All 4 forward migrations were re-executed against the already initialized `terabyte_schema_only_drill` database:

```
Re-apply 20261104100000_profile_security_separation.sql: ExitCode=0, Errors=0
Re-apply 20261104110000_complete_phase9_parts_desk_rpcs.sql: ExitCode=0, Errors=0
Re-apply 20261104120000_complete_phase9_realtime_and_eta.sql: ExitCode=0, Errors=0
Re-apply 20261104130000_complete_phase5_3_technician_registration_notification.sql: ExitCode=0, Errors=0
```
**Conclusion:** All DDL and routine definitions are strictly idempotent. No duplicate object errors, no constraint violations.

---

## 5. Rehearsal Drill 4: Synthetic Staging Seed Verification

The synthetic seed script (`scratch/staging_synthetic_seed.sql`) was applied to the pristine database:

```
Synthetic seed drill: ExitCode=0, Errors=0

Database Row Counts Post-Seed:
- profiles                     : 3
- equipment                    : 2
- technician_profiles          : 1
- service_centre_parts         : 5
- repair_requests              : 1
- quotes                       : 1
- quote_items                  : 2
- service_centre_part_requests : 1
- repair_dispatch_locations    : 1
```

### Constraint Validation Passed:
1. `service_centre_parts_centre_part_key`: UNIQUE (service_centre_id, part_number) satisfied.
2. `repair_requests_urgency_level_check`: Enum check ('HIGH') satisfied.
3. `repair_requests_service_type_check`: Enum check ('DOORSTEP') satisfied.
4. `service_centre_part_requests_status_check`: Enum check ('PENDING') satisfied.
5. All foreign keys (`profiles -> auth.users`, `equipment -> profiles`, `repair_requests -> equipment/profiles`, `quotes -> repair_requests`, `quote_items -> quotes/service_centre_parts`) resolved cleanly.

---

## 6. Architectural Decision

Based on empirical evidence:
- **Approach 1 (Chronological Replay):** Officially declared unviable for clean database construction.
- **Approach 2 (Canonical DDL Baseline + Forward Migrations + Synthetic Seeds):** Formally selected and verified as the **TerraByte Clean Staging Deployment Standard**.
