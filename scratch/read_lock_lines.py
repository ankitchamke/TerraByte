with open("phase9_step5b_production_deployment_assessment.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx in [1940, 1970, 2000, 2075, 2428, 3998]:
    print(f"Line {idx+1}: {lines[idx].strip()}")
