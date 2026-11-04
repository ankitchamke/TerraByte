import glob
import os
import re

mig_files = sorted(glob.glob("supabase/migrations/*.sql"))
print(f"Total migration files in supabase/migrations: {len(mig_files)}")

migrations_data = []

for mf in mig_files:
    fname = os.path.basename(mf)
    with open(mf, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    
    tables_created = re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z0-9_\.\"]+)", content, re.IGNORECASE)
    types_created = re.findall(r"CREATE TYPE ([a-zA-Z0-9_\.\"]+)", content, re.IGNORECASE)
    columns_added = re.findall(r"ALTER TABLE (?:ONLY )?([a-zA-Z0-9_\.\"]+)\s+ADD COLUMN (?:IF NOT EXISTS )?([a-zA-Z0-9_\"]+)", content, re.IGNORECASE)
    functions_created = re.findall(r"CREATE (?:OR REPLACE )?FUNCTION ([a-zA-Z0-9_\.\"]+)", content, re.IGNORECASE)
    triggers_created = re.findall(r"CREATE (?:OR REPLACE )?TRIGGER ([a-zA-Z0-9_\"]+)", content, re.IGNORECASE)
    policies_created = re.findall(r"CREATE POLICY ([a-zA-Z0-9_\"]+)\s+ON\s+([a-zA-Z0-9_\.\"]+)", content, re.IGNORECASE)
    pub_altered = bool(re.search(r"ALTER PUBLICATION\s+([a-zA-Z0-9_]+)", content, re.IGNORECASE))
    
    migrations_data.append({
        "file": fname,
        "size": os.path.getsize(mf),
        "lines": len(content.splitlines()),
        "tables": tables_created,
        "types": types_created,
        "columns": columns_added,
        "functions": functions_created,
        "triggers": triggers_created,
        "policies_count": len(policies_created),
        "realtime": pub_altered
    })

print(f"{'Filename':<55} | {'Size':<8} | {'Tables':<15} | {'Functions':<10} | {'Policies':<8}")
print("-" * 105)
for m in migrations_data:
    tbl_str = ", ".join(m["tables"][:2]) + (f" (+{len(m['tables'])-2})" if len(m['tables']) > 2 else "")
    fn_cnt = len(m["functions"])
    pol_cnt = m["policies_count"]
    print(f"{m['file']:<55} | {m['size']:<8} | {tbl_str:<15} | {fn_cnt:<10} | {pol_cnt:<8}")
