def inspect_conflicts(filepath):
    print(f"\n=== Conflicts in {filepath} ===")
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    
    for i, line in enumerate(lines):
        if line.startswith("<<<<<<<") or line.startswith("=======") or line.startswith(">>>>>>>"):
            start = max(0, i - 2)
            end = min(len(lines), i + 3)
            print(f"Line {i+1}: {line.strip()}")
            for j in range(start, end):
                prefix = ">> " if j == i else "   "
                print(f"{prefix}{j+1}: {lines[j].rstrip()}")
            print("-" * 50)

inspect_conflicts("src/integrations/supabase/types.ts")
inspect_conflicts("src/lib/services/profile.ts")
