import json
from audit_migration_inventory_exact import REMOTE_RECORDED_VERSIONS, intersection

with open("scratch/migration_inventory_audit.json", "r", encoding="utf-8") as f:
    d = json.load(f)

print("=== LOCAL INVENTORY (38 files) ===")
for r in d["local_inventory"]:
    print(f"{r['version']} | {r['filename']} | {r['sha256']}")

print("\n=== REMOTE RECORDED VERSIONS (30 versions) ===")
for v in sorted(REMOTE_RECORDED_VERSIONS):
    print(v)

print("\n=== LOCAL MINUS REMOTE (11 versions) ===")
for item in d["local_minus_remote_versions"]:
    print(f"{item['version']} | {item['filename']} | {item['sha256']}")

print("\n=== REMOTE MINUS LOCAL (3 versions) ===")
for v in d["remote_minus_local_versions"]:
    print(v)

print("\n=== COMMON VERSIONS (27 versions) ===")
for v in intersection:
    print(v)
