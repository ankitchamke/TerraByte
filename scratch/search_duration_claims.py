import json

with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

patterns = [
    "<1ms", "< 1ms", "1-2ms", "1–2ms", "1—2ms", "1 2ms", "sub-millisecond", "submillisecond",
    "zero downtime", "zero-downtime", "guaranteed duration"
]

matches = []
for i, line in enumerate(lines):
    line_lower = line.lower()
    for p in patterns:
        if p in line_lower:
            matches.append({
                "line_number": i + 1,
                "pattern": p,
                "text": line.strip()
            })

print(f"Total matches found: {len(matches)}")
for m in matches:
    print(f"L{m['line_number']} [{m['pattern']}]: {m['text'][:120]}")

with open("scratch/duration_search_results.json", "w", encoding="utf-8") as f:
    json.dump(matches, f, indent=2)
