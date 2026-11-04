import os
import re

MIGRATIONS_DIR = r"D:\Projects\TerraByte\supabase\migrations"

hist_files = [
    "20261003170000_phase5_3_technician_registration_notification.sql",
    "20261029100000_phase9_1_parts_pickup.sql",
    "20261029120000_phase9_2_stock_movement_sales.sql",
    "20261031173000_phase9_3_parts_handoff_rpcs.sql",
    "20261031183000_phase9_3_realtime_publications.sql",
    "20261101140000_phase9_3_unavailable_parts_eta.sql"
]

fwd_files = [
    "20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "20261104120000_complete_phase9_realtime_and_eta.sql",
    "20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

print("=== HISTORICAL MIGRATION ANALYSIS ===")
for hf in hist_files:
    path = os.path.join(MIGRATIONS_DIR, hf)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"\n--- File: {hf} ({len(content)} bytes) ---")
    # Find tables created
    tables = re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)", content, re.I)
    # Find functions created
    functions = re.findall(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    # Find triggers
    triggers = re.findall(r"CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER)\s+([A-Z\s]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    # Find alter table add column
    alters = re.findall(r"ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", content, re.I)
    # Find publications
    pubs = re.findall(r"ALTER\s+PUBLICATION\s+([a-zA-Z0-9_]+)\s+ADD\s+TABLE\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    # Find indexes
    indexes = re.findall(r"CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)
    # Find policies
    policies = re.findall(r"CREATE\s+POLICY\s+\"([^\"]+)\"\s+ON\s+public\.([a-zA-Z0-9_]+)", content, re.I)

    print(f"  Tables ({len(tables)}): {tables}")
    print(f"  Columns added ({len(alters)}): {alters}")
    print(f"  Functions ({len(functions)}): {functions}")
    print(f"  Triggers ({len(triggers)}): {triggers}")
    print(f"  Indexes ({len(indexes)}): {indexes}")
    print(f"  Publication additions ({len(pubs)}): {pubs}")
    print(f"  Policies ({len(policies)}): {[p[0] for p in policies]}")
