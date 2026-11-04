import json

with open("scratch/migration_inventory_audit.json", "r", encoding="utf-8") as f:
    audit_data = json.load(f)

local_migrations = audit_data["local_inventory"]
remote_versions = [
  "20260930000001", "20260930000002", "20260930000003", "20260930000004",
  "20260930000005", "20260930000006", "20260930000007", "20260930000008",
  "20261001151000", "20261001151200", "20261001153500", "20261001163000",
  "20261001170000", "20261002000000", "20261002130000", "20261003131500",
  "20261003140000", "20261003141000", "20261003150000", "20261004100000",
  "20261005100000", "20261006100000", "20261006110000", "20261027100000",
  "20261028110000", "20261031153000", "20261031170000", "20261102100000",
  "20261103100000", "20261103110000"
]

remote_set = set(remote_versions)
latest_remote = max(remote_versions) # "20261103110000"

# Simulation 1: Standard 'supabase db push' (without --include-all)
pending_standard = [m for m in local_migrations if m["version"] > latest_remote and m["version"] not in remote_set]

# Simulation 2: 'supabase db push --include-all'
pending_include_all = [m for m in local_migrations if m["version"] not in remote_set]

print("=== SUPABASE CLI PUSH SELECTION SIMULATION ===")
print(f"Total Local Files: {len(local_migrations)}")
print(f"Total Remote Recorded: {len(remote_versions)}")
print(f"Latest Remote Recorded Version: {latest_remote}\n")

print(f"1. Standard 'supabase db push' would select {len(pending_standard)} migrations:")
for idx, m in enumerate(pending_standard, 1):
    print(f"   [{idx}] {m['version']} | {m['filename']}")

print(f"\n2. 'supabase db push --include-all' would select {len(pending_include_all)} migrations:")
for idx, m in enumerate(pending_include_all, 1):
    print(f"   [{idx}] {m['version']} | {m['filename']}")

with open("scratch/db_push_selection_simulation.json", "w", encoding="utf-8") as f:
    json.dump({
        "latest_remote_version": latest_remote,
        "standard_push_count": len(pending_standard),
        "standard_push_migrations": pending_standard,
        "include_all_push_count": len(pending_include_all),
        "include_all_push_migrations": pending_include_all
    }, f, indent=2)
