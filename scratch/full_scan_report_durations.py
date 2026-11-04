import re
import json

with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

patterns = [
    r"<1ms", r"< 1ms", r"1-2ms", r"1–2ms", r"1—2ms", r"1 2ms",
    r"sub-millisecond", r"submillisecond", r"zero downtime", r"zero-downtime",
    r"instantaneous", r"guaranteed duration", r"no downtime", r"zero-impact"
]

results = []

for idx, line in enumerate(lines, 1):
    for pat in patterns:
        if re.search(pat, line, re.IGNORECASE):
            results.append({
                "line": idx,
                "pattern": pat,
                "text": line.strip()
            })

print(f"Total occurrences found across entire document: {len(results)}")
for r in results:
    print(f"L{r['line']} [{r['pattern']}]: {r['text'][:120]}")

with open("scratch/full_duration_scan_report.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)
