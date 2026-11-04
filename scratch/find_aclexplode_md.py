with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "aclexplode" in line:
        has_acldefault = "acldefault" in line
        print(f"Line {i+1} (acldefault={has_acldefault}): {line.strip()[:100]}...")
