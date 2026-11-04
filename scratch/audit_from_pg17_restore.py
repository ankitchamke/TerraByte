import os
import re
import datetime

path = r"D:\TerraByte_Drill\preflight_sql\from_pg17_restore.sql"
if not os.path.exists(path):
    print(f"File not found: {path}")
    exit(1)

stat = os.stat(path)
print(f"File: {path}")
print(f"Size: {stat.st_size} bytes ({stat.st_size / 1024:.2f} KB)")
print(f"Modified: {datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()}")

with open(path, "r", encoding="utf-8", errors="ignore") as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Look at header lines (first 50)
print("\n--- Header (first 30 lines) ---")
for line in lines[:30]:
    print(line.rstrip())

# Find CREATE TABLE
tables = []
for line in lines:
    m = re.match(r"CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z0-9_\.\"]+)", line, re.IGNORECASE)
    if m:
        tables.append(m.group(1))

print(f"\nTables found ({len(tables)}):")
for t in tables:
    print(f"  {t}")

# Find COPY statements and count rows
copy_blocks = {}
current_copy = None
current_count = 0

for line in lines:
    if line.startswith("COPY "):
        m = re.match(r"COPY ([a-zA-Z0-9_\.\"]+)", line)
        current_copy = m.group(1) if m else line.strip()
        current_count = 0
    elif current_copy is not None:
        if line.strip() == r"\.":
            copy_blocks[current_copy] = current_count
            current_copy = None
        else:
            current_count += 1

print(f"\nCOPY Data row counts ({len(copy_blocks)} tables with data):")
for t, cnt in copy_blocks.items():
    print(f"  {t}: {cnt} rows")

# Find extensions, schemas, RLS policies
schemas = set(re.findall(r"CREATE SCHEMA (?:IF NOT EXISTS )?([a-zA-Z0-9_\"]+)", "".join(lines), re.IGNORECASE))
extensions = set(re.findall(r"CREATE EXTENSION (?:IF NOT EXISTS )?([a-zA-Z0-9_\"]+)", "".join(lines), re.IGNORECASE))
policies = set(re.findall(r"CREATE POLICY ([a-zA-Z0-9_\"]+) ON ([a-zA-Z0-9_\.\"]+)", "".join(lines), re.IGNORECASE))

print(f"\nSchemas ({len(schemas)}): {schemas}")
print(f"Extensions ({len(extensions)}): {extensions}")
print(f"Policies ({len(policies)} policies found)")
