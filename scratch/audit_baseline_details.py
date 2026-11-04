import os
import re
import datetime

path = r"D:\TerraByte_Drill\preflight_sql\from_pg17_restore.sql"
stat = os.stat(path)
print(f"File: {path}")
print(f"Size: {stat.st_size} bytes ({stat.st_size / 1024:.2f} KB)")
print(f"Modified: {datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()}")

with open(path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

# Policies
policies = re.findall(r"CREATE POLICY\s+([^\n]+?)\s+ON\s+([^\n\(\s]+)", text, re.IGNORECASE)
print(f"\nPolicies found: {len(policies)}")
for p, tbl in policies[:15]:
    print(f"  {tbl}: {p}")

# Functions
functions = re.findall(r"CREATE FUNCTION\s+([^\s\(]+)", text, re.IGNORECASE)
print(f"\nFunctions found: {len(functions)}")
for fn in functions[:15]:
    print(f"  {fn}")

# Triggers
triggers = re.findall(r"CREATE TRIGGER\s+([^\s]+)\s+([^\n]+?)\s+ON\s+([^\s]+)", text, re.IGNORECASE)
print(f"\nTriggers found: {len(triggers)}")
for tname, timing, tbl in triggers[:15]:
    print(f"  {tbl}: {tname}")

# Check tables in public
public_tables = re.findall(r"CREATE TABLE\s+(?:IF NOT EXISTS\s+)?\"public\"\.([a-zA-Z0-9_\"]+)", text, re.IGNORECASE)
print(f"\nPublic tables ({len(public_tables)}):")
for pt in sorted(public_tables):
    print(f"  public.{pt}")
