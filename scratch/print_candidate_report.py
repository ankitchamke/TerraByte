import json

with open('scratch/candidate_verification.json') as f:
    d = json.load(f)

for k, v in d.items():
    print(f"{k}: {v['filename']}")
    print(f"  Size: {v['size']} bytes")
    print(f"  SHA256: {v['sha256']}")
    print(f"  Functions: {v['functions']}")
    print(f"  Tables: {v['tables']}")
    print(f"  Triggers: {v['triggers']}")
    print(f"  Policies: {v['policies']}")
    print(f"  Columns: {v['columns']}")
    print(f"  Indexes: {v['indexes']}")
    print(f"  Superseded: {v['superseded_by']}")
    print()
