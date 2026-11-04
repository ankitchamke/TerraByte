import os
import re
from parse_sql_statements import split_sql_statements

migrations = [
    {
        "id": "A",
        "version": "20261104110000",
        "filename": "20261104110000_complete_phase9_parts_desk_rpcs.sql",
        "path": r"D:\Projects\TerraByte\supabase\migrations\20261104110000_complete_phase9_parts_desk_rpcs.sql"
    },
    {
        "id": "B",
        "version": "20261104120000",
        "filename": "20261104120000_complete_phase9_realtime_and_eta.sql",
        "path": r"D:\Projects\TerraByte\supabase\migrations\20261104120000_complete_phase9_realtime_and_eta.sql"
    },
    {
        "id": "C",
        "version": "20261104130000",
        "filename": "20261104130000_complete_phase5_3_technician_registration_notification.sql",
        "path": r"D:\Projects\TerraByte\supabase\migrations\20261104130000_complete_phase5_3_technician_registration_notification.sql"
    }
]

def classify_statement(stmt_text):
    text = stmt_text.strip()
    upper = text.upper()
    if upper.startswith("CREATE INDEX") or upper.startswith("CREATE UNIQUE INDEX"):
        return "INDEX_CREATION"
    elif upper.startswith("CREATE OR REPLACE FUNCTION"):
        return "FUNCTION_DEFINITION"
    elif upper.startswith("REVOKE"):
        return "PERMISSION_REVOKE"
    elif upper.startswith("GRANT"):
        return "PERMISSION_GRANT"
    elif upper.startswith("DO"):
        return "DO_BLOCK"
    elif upper.startswith("ALTER TABLE") and "REPLICA IDENTITY" in upper:
        return "ALTER_REPLICA_IDENTITY"
    elif upper.startswith("ALTER TABLE") and "ADD COLUMN" in upper:
        return "ALTER_ADD_COLUMNS"
    elif upper.startswith("DROP POLICY"):
        return "DROP_POLICY"
    elif upper.startswith("CREATE POLICY"):
        return "CREATE_POLICY"
    elif upper.startswith("DROP TRIGGER"):
        return "DROP_TRIGGER"
    elif upper.startswith("CREATE TRIGGER"):
        return "CREATE_TRIGGER"
    else:
        return "OTHER"

all_parsed = []
global_unit_id = 1

for m in migrations:
    with open(m["path"], "r", encoding="utf-8") as f:
        content = f.read()
    raw_stmts = split_sql_statements(content)
    print(f"Migration {m['id']} ({m['version']}): {len(raw_stmts)} statements")
    
    for s_idx, s in enumerate(raw_stmts, start=1):
        s_type = classify_statement(s["text"])
        lines = [l for l in s["text"].split("\n") if l.strip() and not l.strip().startswith("--")]
        boundary_first = lines[0].strip() if lines else ""
        boundary_last = lines[-1].strip() if lines else ""
        
        all_parsed.append({
            "unit_id": f"REQ-{global_unit_id:02d}",
            "migration_id": m["id"],
            "migration_ver": m["version"],
            "local_idx": s_idx,
            "start_line": s["start"],
            "end_line": s["end"],
            "type": s_type,
            "boundary_first": boundary_first,
            "boundary_last": boundary_last,
            "text": s["text"]
        })
        global_unit_id += 1

print(f"Total SQL Requests: {len(all_parsed)}")

# Save to scratch json for reporting
import json
with open("scratch/all_parsed_requests.json", "w", encoding="utf-8") as f:
    json.dump(all_parsed, f, indent=2)
print("Saved parsed requests to scratch/all_parsed_requests.json")
