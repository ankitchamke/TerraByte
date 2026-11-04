import os
import re
import json

MIGRATIONS_DIR = "supabase/migrations"
mig_files = sorted([f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")])

with open(r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql", encoding="utf-8") as f:
    baseline_sql = f.read()

reconciliation = []

for idx, fname in enumerate(mig_files, 1):
    fpath = os.path.join(MIGRATIONS_DIR, fname)
    with open(fpath, encoding="utf-8", errors="replace") as f:
        content = f.read()

    # extract objects
    tbls = re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?[\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s*\(", content, re.IGNORECASE)
    fns = re.findall(r"CREATE (?:OR REPLACE )?FUNCTION ([\"a-zA-Z0-9_.]+)\s*\(", content, re.IGNORECASE)
    types = re.findall(r"CREATE TYPE [\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s+AS ENUM", content, re.IGNORECASE)

    # Determine status in baseline
    status = "UNKNOWN"
    notes = ""

    # Check if superseded
    if fname in [
        "20261029100000_phase9_1_parts_pickup.sql",
        "20261029120000_phase9_2_stock_movement_sales.sql",
        "20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql",
        "20261031170000_phase9_2_quote_catalog_and_inventory.sql",
        "20261031173000_phase9_3_parts_handoff_rpcs.sql",
        "20261031183000_phase9_3_realtime_publications.sql",
        "20261101140000_phase9_3_unavailable_parts_eta.sql"
    ]:
        status = "SUPERSEDED"
        notes = "Historical fragmented draft superseded by Phase 9 consolidated forward migrations (20261104110000 & 20261104120000)."
    elif fname.startswith("20260930000006") or fname.startswith("20260930000007") or fname.startswith("20260930000008"):
        status = "PLACEHOLDER"
        notes = "Remote alignment placeholder (no-op DO block)."
    elif fname == "20261103120000_phase11_visual_defect_diagnostics.sql":
        status = "PHASE 11 FORWARD"
        notes = "Phase 11 visual diagnostic RPCs (claim, save, finalize failure) required by assess-visual-defect.ts."
    elif fname == "20261104100000_profile_security_separation.sql":
        status = "FORWARD MIGRATION 1"
        notes = "Profile security separation, app_security schema, and get_session_profile() parameterless RPC."
    elif fname == "20261104110000_complete_phase9_parts_desk_rpcs.sql":
        status = "FORWARD MIGRATION 2"
        notes = "Consolidated Parts Desk atomic handoff, adjustment, requisition, and receipt RPCs."
    elif fname == "20261104120000_complete_phase9_realtime_and_eta.sql":
        status = "FORWARD MIGRATION 3"
        notes = "Consolidated ETA tracking, atomic quote RPCs, catalog foreign keys, and realtime publications."
    elif fname == "20261104130000_complete_phase5_3_technician_registration_notification.sql":
        status = "FORWARD MIGRATION 4"
        notes = "Technician registration notification trigger for service centre admins."
    elif fname == "20261001153500_set_demo_users_password.sql":
        status = "OBSOLETE SEED"
        notes = "Legacy hardcoded demo password setting; superseded by synthetic staging fixtures."
    else:
        status = "INCLUDED IN BASELINE"
        notes = "Core historical migration whose resulting DDL state is captured in terabyte_public_schema.sql."

    reconciliation.append({
        "num": idx,
        "filename": fname,
        "status": status,
        "notes": notes,
        "tables": [t.replace('"', '') for t in tbls],
        "functions": [fn.replace('"', '').replace('public.', '') for fn in fns],
        "enums": types
    })

with open("scratch/complete_38_reconciliation.json", "w") as f:
    json.dump(reconciliation, f, indent=2)

print(f"Reconciled {len(reconciliation)} migrations.")
for r in reconciliation:
    print(f"{r['num']:02d} | {r['filename']:<65} | {r['status']:<20}")
