with open('src/hooks/use-repair-realtime.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'postgres_changes' in line or 'table:' in line or 'event:' in line or 'filter:' in line:
        print(f"{i+1}: {line.strip()}")
