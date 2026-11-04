import os
import re
import json

# 1. Parse types.ts
TYPES_PATH = "src/integrations/supabase/types.ts"
with open(TYPES_PATH, "r", encoding="utf-8") as f:
    types_content = f.read()

# Tables in types.ts
# Match tables under public: { Tables: { ... } }
tables_block_match = re.search(r"public:\s*\{\s*Tables:\s*\{(.*?)\n\s*Views:", types_content, re.DOTALL)
types_tables = []
if tables_block_match:
    types_tables = re.findall(r"^\s{6}([a-zA-Z0-9_]+):\s*\{", tables_block_match.group(1), re.MULTILINE)

# Functions in types.ts
funcs_block_match = re.search(r"public:\s*\{.*?Functions:\s*\{(.*?)\n\s*Enums:", types_content, re.DOTALL)
types_funcs = []
if funcs_block_match:
    types_funcs = re.findall(r"^\s{6}([a-zA-Z0-9_]+):\s*\{", funcs_block_match.group(1), re.MULTILINE)

# Enums in types.ts
enums_block_match = re.search(r"public:\s*\{.*?Enums:\s*\{(.*?)\n\s*CompositeTypes:", types_content, re.DOTALL)
types_enums = []
if enums_block_match:
    types_enums = re.findall(r"^\s{6}([a-zA-Z0-9_]+):", enums_block_match.group(1), re.MULTILINE)

print(f"types.ts: Tables={len(types_tables)}, Functions={len(types_funcs)}, Enums={len(types_enums)}")
print("  Tables:", types_tables)
print("  Enums:", types_enums)
print("  Functions in types.ts:", sorted(types_funcs))

# 2. Parse frontend RPC calls in src/
frontend_rpcs = set()
for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith(".ts") or file.endswith(".tsx"):
            filepath = os.path.join(root, file)
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
                matches = re.findall(r'\.rpc\(\s*["\']([a-zA-Z0-9_]+)["\']', content)
                for m in matches:
                    frontend_rpcs.add(m)

print(f"\nFrontend .rpc() calls in src/: ({len(frontend_rpcs)})")
for rpc in sorted(frontend_rpcs):
    print("  -", rpc)

# 3. Check objects in baseline terabyte_public_schema.sql
BASELINE_PATH = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql"
with open(BASELINE_PATH, "r", encoding="utf-8") as f:
    baseline_sql = f.read()

baseline_tables = set(re.findall(r"CREATE TABLE [\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s*\(", baseline_sql, re.IGNORECASE))
baseline_enums = set(re.findall(r"CREATE TYPE [\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s+AS ENUM", baseline_sql, re.IGNORECASE))
baseline_funcs = set([m.replace('"', '').replace('public.', '') for m in re.findall(r"CREATE FUNCTION ([\"a-zA-Z0-9_.]+)\s*\(", baseline_sql)])

print(f"\nBaseline: Tables={len(baseline_tables)}, Enums={len(baseline_enums)}, Funcs={len(baseline_funcs)}")

# 4. Check objects added by 4 forward migrations
forward_migs = [
    "supabase/migrations/20261104100000_profile_security_separation.sql",
    "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
    "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

forward_added_tables = {}
forward_added_funcs = {}

for m in forward_migs:
    fname = os.path.basename(m)
    with open(m, "r", encoding="utf-8") as f:
        sql = f.read()
    tbls = re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?([\"a-zA-Z0-9_.]+)\s*\(", sql, re.IGNORECASE)
    fns = re.findall(r"CREATE (?:OR REPLACE )?FUNCTION ([a-zA-Z0-9_.]+)\s*\(", sql, re.IGNORECASE)
    forward_added_tables[fname] = [t.replace('"', '') for t in tbls]
    forward_added_funcs[fname] = [fn.replace('"', '') for fn in fns]

print("\nForward Migration Additions:")
for fname in forward_added_tables:
    print(f"  {fname}:")
    print(f"    Tables added: {forward_added_tables[fname]}")
    print(f"    Functions added/replaced: {forward_added_funcs[fname]}")

# 5. Check compatibility of frontend RPCs
all_available_funcs = set(baseline_funcs)
for fns in forward_added_funcs.values():
    for fn in fns:
        all_available_funcs.add(fn.replace("public.", "").replace("app_security.", ""))

unsatisfied_rpcs = frontend_rpcs - all_available_funcs
print(f"\nUnsatisfied Frontend RPCs: {unsatisfied_rpcs}")

results = {
    "types_tables": types_tables,
    "types_funcs": types_funcs,
    "types_enums": types_enums,
    "frontend_rpcs": list(frontend_rpcs),
    "baseline_tables": list(baseline_tables),
    "baseline_enums": list(baseline_enums),
    "baseline_funcs": list(baseline_funcs),
    "forward_added_tables": forward_added_tables,
    "forward_added_funcs": forward_added_funcs,
    "unsatisfied_rpcs": list(unsatisfied_rpcs)
}

with open("scratch/schema_reconciliation_audit.json", "w") as f:
    json.dump(results, f, indent=2)
