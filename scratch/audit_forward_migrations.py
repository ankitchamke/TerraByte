import os
import re

MIGRATIONS_DIR = r"D:\Projects\TerraByte\supabase\migrations"

fwd_files = [
    "20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "20261104120000_complete_phase9_realtime_and_eta.sql",
    "20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

print("=== FORWARD MIGRATION ANALYSIS ===")
for ff in fwd_files:
    path = os.path.join(MIGRATIONS_DIR, ff)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"\n--- File: {ff} ({len(content)} bytes) ---")
    tables = re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)", content, re.I)
    functions = re.findall(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    triggers = re.findall(r"CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER)\s+([A-Z\s]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    alters = re.findall(r"ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", content, re.I)
    pubs = re.findall(r"ALTER\s+PUBLICATION\s+([a-zA-Z0-9_]+)\s+ADD\s+TABLE\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    indexes = re.findall(r"CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    policies = re.findall(r"CREATE\s+POLICY\s+\"([^\"]+)\"\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)

    print(f"  Tables ({len(tables)}): {tables}")
    print(f"  Columns added ({len(alters)}): {alters}")
    print(f"  Functions ({len(functions)}): {functions}")
    print(f"  Triggers ({len(triggers)}): {triggers}")
    print(f"  Indexes ({len(indexes)}): {indexes}")
    print(f"  Publication additions ({len(pubs)}): {pubs}")
    print(f"  Policies ({len(policies)}): {[p[0] for p in policies]}")
