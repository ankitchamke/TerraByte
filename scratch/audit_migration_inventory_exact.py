import os
import hashlib
import json
import csv
import re

MIGRATIONS_DIR = "supabase/migrations"

# 30 remote recorded versions from supabase_migrations.schema_migrations queried read-only from production
REMOTE_RECORDED_VERSIONS = [
  "20260930000001", "20260930000002", "20260930000003", "20260930000004",
  "20260930000005", "20260930000006", "20260930000007", "20260930000008",
  "20261001151000", "20261001151200", "20261001153500", "20261001163000",
  "20261001170000", "20261002000000", "20261002130000", "20261003131500",
  "20261003140000", "20261003141000", "20261003150000", "20261004100000",
  "20261005100000", "20261006100000", "20261006110000", "20261027100000",
  "20261028110000", "20261031153000", "20261031170000", "20261102100000",
  "20261103100000", "20261103110000"
]

files = sorted(os.listdir(MIGRATIONS_DIR))
local_records = []
local_version_counts = {}
invalid_filenames = []

version_regex = re.compile(r"^(\d{14})_(.+)\.sql$")

for f in files:
    full_path = os.path.join(MIGRATIONS_DIR, f)
    if not os.path.isfile(full_path):
        continue
    
    m = version_regex.match(f)
    if not m:
        invalid_filenames.append(f)
        version = f.split("_")[0]
        desc = "_".join(f.split("_")[1:])
    else:
        version = m.group(1)
        desc = m.group(2)
        
    size_bytes = os.path.getsize(full_path)
    with open(full_path, "rb") as bf:
        sha256 = hashlib.sha256(bf.read()).hexdigest().upper()
        
    local_version_counts[version] = local_version_counts.get(version, 0) + 1
    
    local_records.append({
        "version": version,
        "filename": f,
        "description": desc,
        "size_bytes": size_bytes,
        "sha256": sha256
    })

# Sort local records by version
local_records.sort(key=lambda x: x["version"])

# Duplicate version check
duplicates = {v: count for v, count in local_version_counts.items() if count > 1}

local_version_set = set(r["version"] for r in local_records)
remote_version_set = set(REMOTE_RECORDED_VERSIONS)

local_minus_remote = sorted(list(local_version_set - remote_version_set))
remote_minus_local = sorted(list(remote_version_set - local_version_set))
intersection = sorted(list(local_version_set & remote_version_set))

audit_data = {
    "total_local_files": len(local_records),
    "total_remote_recorded_versions": len(REMOTE_RECORDED_VERSIONS),
    "duplicate_versions_found": duplicates,
    "invalid_filenames_found": invalid_filenames,
    "local_minus_remote_count": len(local_minus_remote),
    "local_minus_remote_versions": [
        {"version": v, "filename": next(r["filename"] for r in local_records if r["version"] == v), "sha256": next(r["sha256"] for r in local_records if r["version"] == v)}
        for v in local_minus_remote
    ],
    "remote_minus_local_count": len(remote_minus_local),
    "remote_minus_local_versions": remote_minus_local,
    "common_versions_count": len(intersection),
    "local_inventory": local_records
}

# Save JSON
with open("scratch/migration_inventory_audit.json", "w", encoding="utf-8") as f:
    json.dump(audit_data, f, indent=2)

# Save CSV
with open("scratch/migration_inventory_audit.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Version", "Filename", "Size_Bytes", "SHA256", "In_Remote_History", "Category"])
    for r in local_records:
        v = r["version"]
        in_remote = v in remote_version_set
        if not in_remote:
            if v in ["20261003170000", "20261029100000", "20261029120000", "20261031173000", "20261031183000", "20261101140000"]:
                cat = "Historical Unrecorded (Superseded)"
            elif v in ["20261103120000", "20261104100000"]:
                cat = "Phase 11 (Unapplied Visual Defect)"
            elif v in ["20261104110000", "20261104120000", "20261104130000"]:
                cat = "Phase 9 Forward Package"
            else:
                cat = "Unclassified Unrecorded"
        else:
            cat = "Recorded in Remote History"
        writer.writerow([r["version"], r["filename"], r["size_bytes"], r["sha256"], in_remote, cat])

print(f"Total Local Files: {len(local_records)}")
print(f"Total Remote Versions: {len(REMOTE_RECORDED_VERSIONS)}")
print(f"Duplicates: {duplicates}")
print(f"Invalid Filenames: {invalid_filenames}")
print(f"Local-minus-Remote: {len(local_minus_remote)}")
print(f"Remote-minus-Local: {len(remote_minus_local)}")
print(f"Common: {len(intersection)}")
print("\nLocal-minus-Remote (Unrecorded):")
for item in audit_data["local_minus_remote_versions"]:
    print(f"  {item['version']} | {item['filename']} | {item['sha256'][:16]}...")
print("\nRemote-minus-Local (Missing Files):")
for v in remote_minus_local:
    print(f"  {v}")
