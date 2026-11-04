import os
import hashlib
import json

backup_dir = r"D:\TerraByte_Backups\production_backup_20261103_151328"
manifest_path = os.path.join(backup_dir, "backup_manifest.json")

with open(manifest_path, "r", encoding="utf-8-sig") as f:
    manifest = json.load(f)

print(f"Manifest Project: {manifest.get('project_name')} ({manifest.get('project_ref')})")
print(f"Server PG Version: {manifest.get('server_postgres_version')}")
print(f"Client Dump Version: {manifest.get('client_pg_dump_version')}")
print(f"Timestamp UTC: {manifest.get('backup_timestamp_utc')}")
print("\nVerifying SHA256 for all manifest files:")

all_match = True
for entry in manifest.get("files", []):
    rel_path = entry["Path"]
    expected_hash = entry["SHA256"]
    expected_size = entry["SizeBytes"]
    full_path = os.path.join(backup_dir, rel_path)
    
    if not os.path.exists(full_path):
        print(f"MISSING: {rel_path}")
        all_match = False
        continue
        
    actual_size = os.path.getsize(full_path)
    with open(full_path, "rb") as bf:
        actual_hash = hashlib.sha256(bf.read()).hexdigest().upper()
        
    match = (actual_hash == expected_hash) and (actual_size == expected_size)
    print(f"  {rel_path:<55} | Size: {actual_size} B | Hash Match: {match}")
    if not match:
        all_match = False

print(f"\nOverall Manifest Verification: {'100% MATCH' if all_match else 'FAILED'}")
