with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

phrases = ["<1ms", "1-2ms", "1–2ms", "sub-millisecond", "zero downtime", "millisecond"]

for i, line in enumerate(lines):
    for p in phrases:
        if p in line.lower():
            print(f"Line {i+1} [{p}]: {line.strip()[:100]}...")
            break
