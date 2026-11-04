with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

words = ["millisecond", "downtime", "duration", "guarantee", "< 1", "<1", "< 10", "<10"]

for i, line in enumerate(lines):
    l_lower = line.lower()
    for w in words:
        if w in l_lower:
            print(f"Line {i+1} [{w}]: {line.strip()[:100]}...")
            break
