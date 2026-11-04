import json

with open("scratch/full_request_catalog_v8.json", "r", encoding="utf-8") as f:
    catalog = json.load(f)

raw_count = 0
acldefault_count = 0
for r in catalog:
    vq = r.get("strengthened_vquery", "")
    if "aclexplode" in vq:
        if "acldefault" not in vq:
            raw_count += 1
            print(f"RAW ACL in {r['unit_id']}")
        else:
            acldefault_count += 1

print(f"Total acldefault queries: {acldefault_count}")
print(f"Total raw aclexplode queries without acldefault: {raw_count}")
