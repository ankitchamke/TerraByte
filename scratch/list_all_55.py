import json

with open("scratch/all_parsed_requests.json", "r", encoding="utf-8") as f:
    requests = json.load(f)

print(f"Total requests: {len(requests)}")
for r in requests:
    print(f"{r['unit_id']}: {r['type']:<25} | {r['text'][:60]}...")
