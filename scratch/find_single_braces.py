with open("scratch/assemble_version8_document.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "{" in line and not any(v in line for v in ["{table_a}", "{details_a}", "{table_b}", "{details_b}", "{table_c}", "{details_c}"]):
        # check if it contains unescaped single brace
        # In python f-string, double {{ is fine, but single { is an expression
        # Let's find occurrences of single { not preceded or followed by { or }
        for j, ch in enumerate(line):
            if ch == '{' and (j == 0 or line[j-1] != '{') and (j == len(line)-1 or line[j+1] != '{'):
                print(f"Line {i+1}: {line.strip()[:80]}")
                break
