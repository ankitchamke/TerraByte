import os
import json
import re

hist_files = {
    "20261003170000": "supabase/migrations/20261003170000_phase5_3_technician_registration_notification.sql",
    "20261029100000": "supabase/migrations/20261029100000_phase9_1_parts_pickup.sql",
    "20261029120000": "supabase/migrations/20261029120000_phase9_2_stock_movement_sales.sql",
    "20261031173000": "supabase/migrations/20261031173000_phase9_3_parts_handoff_rpcs.sql",
    "20261031183000": "supabase/migrations/20261031183000_phase9_3_realtime_publications.sql",
    "20261101140000": "supabase/migrations/20261101140000_phase9_3_unavailable_parts_eta.sql"
}

forward_files = {
    "20261104110000": "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "20261104120000": "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
    "20261104130000": "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
}

def parse_objects(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    objects = []
    current_obj = None
    
    for idx, line in enumerate(lines):
        line_num = idx + 1
        line_clean = line.strip()
        
        # Check patterns
        if line_clean.upper().startswith("CREATE TABLE"):
            m = re.search(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "TABLE", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("ALTER TABLE") and ("ADD COLUMN" in line_clean.upper() or "DROP CONSTRAINT" in line_clean.upper() or "ENABLE ROW LEVEL SECURITY" in line_clean.upper() or "REPLICA IDENTITY" in line_clean.upper()):
            objects.append({"type": "ALTER_TABLE", "name": line_clean[:60], "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("CREATE INDEX"):
            m = re.search(r"CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "INDEX", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("CREATE OR REPLACE FUNCTION") or line_clean.upper().startswith("CREATE FUNCTION"):
            m = re.search(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "FUNCTION", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("CREATE TRIGGER"):
            m = re.search(r"CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([^\s]+)", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "TRIGGER", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("DROP TRIGGER"):
            m = re.search(r"DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([^\s]+)", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "DROP_TRIGGER", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("CREATE POLICY"):
            m = re.search(r"CREATE\s+POLICY\s+\"([^\"]+)\"", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "POLICY", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("DROP POLICY"):
            m = re.search(r"DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?\"?([^\s\"]+)\"?", line_clean, re.I)
            name = m.group(1) if m else line_clean
            objects.append({"type": "DROP_POLICY", "name": name, "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("ALTER PUBLICATION"):
            objects.append({"type": "PUBLICATION", "name": line_clean[:60], "line": line_num, "text": line_clean})
        elif line_clean.upper().startswith("GRANT") or line_clean.upper().startswith("REVOKE"):
            objects.append({"type": "GRANT_REVOKE", "name": line_clean[:60], "line": line_num, "text": line_clean})
            
    return objects

results = {}
for ver, path in hist_files.items():
    results[ver] = {
        "file": path,
        "objects": parse_objects(path)
    }

print("Historical files parsed:")
for ver, d in results.items():
    print(f"  {ver} ({d['file']}): {len(d['objects'])} objects")

with open("scratch/historical_objects_parsed.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)
