# TerraByte Scratch & Disposable Verification Workspace

This directory contains temporary scripts, forensic analysis tools, test runners, and intermediate JSON/CSV data files generated during independent database audits, migration rehearsals, and schema verification drills (Phase 9 and Phase 11).

> [!NOTE]
> All files in this directory are preserved for forensic auditability and local reproducible verification.
> **No production credentials, API secrets, or real customer data are stored here.**

---

## Directory Inventory

The scratch workspace includes:

1. **Phase-Specific Scratch Workspaces (`scratch/<phase>/`):**
   - `scratch/phase-a1/`: Git-ignored workspace retaining sanitized UI verification screenshots (`screenshots/`) and markdown link validation tools (`verify_links.mjs`). Ephemeral browser testing profiles and temporary credential-testing scripts were securely removed to enforce zero-secret hygiene.

2. **Python Test & Analysis Harnesses (`*.py`):**
   - Independent SQL statement parsers and AST analyzers.
   - Forensic migration inventory comparators (`audit_historical_vs_forward.py`, `deep_compare_historical_vs_forward.py`).
   - Local disposable PostgreSQL 17 test orchestrators (`test_clean_install_rehearsal.py`, `test_step5a*.py`).
   - RPC signature and parameter verification scripts (`audit_all_8_rpcs_deep.py`).
   - Security verification scripts for RLS policies and `SECURITY DEFINER` routines.

3. **Rehearsal SQL Scripts (`*.sql`):**
   - Targeted DDL/DML statements tested against local disposable database instances.
   - Non-production synthetic seed fixtures (`staging_synthetic_seed.sql`).
   - Trigger and routine state verification queries (`temp_trigger_test.sql`, `test_v7_funcs.sql`).

4. **Forensic Audit Outputs (`*.json`, `*.csv`):**
   - Complete 38-migration reconciliation matrices (`complete_38_reconciliation.json`).
   - Database routine and table catalog snapshots (`tables_rendered_*.json`).
   - Rehearsal and drill result logs (`clean_rehearsal_results.json`, `backup_restore_drill_results.json`).

---

## File Placement & Usage Guidelines

- **No Root Clutter:** Never create temporary scripts, test harnesses, or exploratory scratch files in the repository root. All temporary scripts must be located within `scratch/<phase>/`.
- **Permanent Tests Belong in `tests/`:** Any automated test that provides continuous regression protection must be placed in `tests/` with the `.test.mjs` extension.
- **Disposable Environment:** Scripts in this directory are designed to connect strictly to local disposable test databases (e.g., local PostgreSQL on port 5433 or ephemeral SQLite/containers), or execute read-only verification.
- **Prohibited:** Never configure or point scripts in this directory to execute write operations or migrations against remote staging or production Supabase environments.
