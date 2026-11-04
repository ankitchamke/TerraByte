import json
import hashlib
import os

artifacts = [
    {
        "artifact_id": "HISTORICAL_EQUIVALENCE_MATRIX_JSON",
        "path": "scratch/detailed_historical_equivalence_matrix.json",
        "generation_command": "python scratch/comprehensive_historical_equivalence_audit.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Forensic, object-by-object proof that all 36 operations across the 6 historical migrations are accounted for (34 EQUIVALENT, 2 NOT_APPLICABLE).",
        "limitations": "Proves schema equivalence only; does not authorize modifying remote migration history."
    },
    {
        "artifact_id": "HISTORICAL_EQUIVALENCE_MATRIX_CSV",
        "path": "scratch/detailed_historical_equivalence_matrix.csv",
        "generation_command": "python scratch/comprehensive_historical_equivalence_audit.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Tabular export of detailed equivalence matrix with line numbers for historical and forward migrations.",
        "limitations": "Static analysis of migration SQL files and remote catalog."
    },
    {
        "artifact_id": "MIGRATION_INVENTORY_JSON",
        "path": "scratch/migration_inventory_audit.json",
        "generation_command": "python scratch/audit_migration_inventory_exact.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Exact inventory of 38 local files and 30 remote recorded versions, proving 11 local-only, 3 remote-only, 27 intersection, 0 duplicates, 0 invalid filenames.",
        "limitations": "Reflects local filesystem and remote schema_migrations snapshot."
    },
    {
        "artifact_id": "MIGRATION_INVENTORY_CSV",
        "path": "scratch/migration_inventory_audit.csv",
        "generation_command": "python scratch/audit_migration_inventory_exact.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Spreadsheet-compatible inventory of all local migrations with SHA256 hashes.",
        "limitations": "Read-only inventory."
    },
    {
        "artifact_id": "CLI_PUSH_SELECTION_SIMULATION",
        "path": "scratch/db_push_selection_simulation.json",
        "generation_command": "python scratch/simulate_db_push_selection.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Proves that standard 'supabase db push' selects 5 files (including Phase 11) while '--include-all' selects 11 files (failing on historical collisions).",
        "limitations": "Simulates Supabase CLI 3.0.0 Go logic; not executed against remote production."
    },
    {
        "artifact_id": "SIX_TRIGGER_STATES_JSON",
        "path": "scratch/six_trigger_states_results.json",
        "generation_command": "python scratch/test_all_six_trigger_states.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Proves that structural catalog bitmasks (tgtype, tgfoid, tgenabled, tgisinternal) correctly classify all 6 operational trigger states (6/6 PASS).",
        "limitations": "Executed on isolated local drill DB; not on live production."
    },
    {
        "artifact_id": "FIVE_INDEX_STATES_JSON",
        "path": "scratch/five_index_states_results.json",
        "generation_command": "python scratch/test_all_five_index_states.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Proves that index inspection query accurately validates indisvalid, indisready, and definition across all 5 operational states (5/5 PASS).",
        "limitations": "Executed on isolated local drill DB; not on live production."
    },
    {
        "artifact_id": "LOCK_TIMEOUT_DRILL_JSON",
        "path": "scratch/lock_timeout_drill_results.json",
        "generation_command": "python scratch/test_lock_timeout_modes.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Proves that 'BEGIN; SET LOCAL lock_timeout = '3s'; ...; COMMIT;' enforces 3s timeout in-transaction and reverts to 0 upon commit.",
        "limitations": "Validated on local PostgreSQL 17.6; remote CLI execution path not tested against production to avoid mutation."
    },
    {
        "artifact_id": "HISTORICAL_DRILL_STEP5B8_JSON",
        "path": "scratch/step5b8_drill_test_results.json",
        "generation_command": "python scratch/run_complete_55_audit.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Historical 165-execution drill results from Step 5B.8 (55 P1 + 55 P2 + 55 P3 = 165 PASS).",
        "limitations": "Historical artifact from previous step; superseded by fresh Step 5B.10 drill."
    },
    {
        "artifact_id": "FRESH_DRILL_STEP5B10_JSON",
        "path": "scratch/step5b10_drill_test_results.json",
        "generation_command": "python scratch/run_fresh_step5b10_audit.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Fresh, independently executed 165-execution drill audit covering all 55 requests across 3 phases (165/165 PASS).",
        "limitations": "Proves SQL validity on clean restored DB; does not verify live traffic concurrency or frontend integration."
    },
    {
        "artifact_id": "FRESH_DRILL_STEP5B10_LOG",
        "path": "scratch/step5b10_drill_execution.log",
        "generation_command": "python scratch/run_fresh_step5b10_audit.py",
        "environment": "PostgreSQL 17.6 Drill DB (127.0.0.1:5433, terabyte_clean_restore_drill)",
        "what_it_proves": "Complete chronological execution trace of all 165 executions in Step 5B.10.",
        "limitations": "Local drill log."
    },
    {
        "artifact_id": "FULL_DURATION_SCAN_JSON",
        "path": "scratch/full_duration_scan_report.json",
        "generation_command": "python scratch/full_scan_report_durations.py",
        "environment": "Local Workspace (Windows Python 3.14)",
        "what_it_proves": "Exhaustive scan proving zero occurrences of speculative duration claims across all 55 requests in the assessment report.",
        "limitations": "Text-based pattern search."
    }
]

index_entries = []
for a in artifacts:
    p = a["path"]
    if os.path.exists(p):
        with open(p, "rb") as f:
            raw = f.read()
        sha = hashlib.sha256(raw).hexdigest().upper()
        size = len(raw)
    else:
        sha = "FILE_NOT_FOUND"
        size = 0
    
    a["sha256"] = sha
    a["size_bytes"] = size
    index_entries.append(a)

output_data = {
    "audit_version": "Step 5B.11 Final Evidence Inspection",
    "timestamp_utc": "2026-11-03T19:10:00Z",
    "total_artifacts": len(index_entries),
    "artifacts": index_entries
}

with open("scratch/evidence_index.json", "w", encoding="utf-8") as f:
    json.dump(output_data, f, indent=2)

print(f"Generated scratch/evidence_index.json with {len(index_entries)} indexed artifacts.")
for a in index_entries:
    print(f"  {a['artifact_id']}: {a['size_bytes']} B | SHA256: {a['sha256'][:16]}... | {a['path']}")
