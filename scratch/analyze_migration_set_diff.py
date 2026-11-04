import os
import json

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

mig_dir = "supabase/migrations"
local_files = [f for f in os.listdir(mig_dir) if f.endswith(".sql")]

local_versions = {}
for f in local_files:
    v = f.split("_")[0]
    local_versions[v] = f

remote_set = set(remote_versions)
local_set = set(local_versions.keys())

# What is local but NOT in remote?
unrecorded_local = sorted(list(local_set - remote_set))

print(f"Total local migration files: {len(local_files)}")
print(f"Total remote recorded versions: {len(remote_versions)}")
print(f"Total local versions NOT recorded in remote: {len(unrecorded_local)}")
print("\nExact List of Unrecorded Local Migrations:")
for v in unrecorded_local:
    print(f"  {v}: {local_versions[v]}")

# What is remote but NOT in local?
missing_local = sorted(list(remote_set - local_set))
print(f"\nTotal remote versions with NO corresponding local file: {len(missing_local)}")
for v in missing_local:
    print(f"  {v}")
