with open('src/hooks/use-repair-realtime.ts', 'r', encoding='utf-8') as f:
    text = f.read()

lines = text.split('\n')
for i, line in enumerate(lines):
    if 'postgres_changes' in line:
        print(f"--- Around line {i+1} ---")
        start = max(0, i - 2)
        end = min(len(lines), i + 25)
        for j in range(start, end):
            print(f"{j+1}: {lines[j]}")
