with open('src/hooks/use-repair-realtime.ts', 'r', encoding='utf-8') as f:
    text = f.read()

import re

# Find all .on("postgres_changes", ...) blocks
blocks = re.findall(r'\.on\(\s*"postgres_changes"[\s\S]*?\)\s*\{[\s\S]*?\}\s*\)', text)
print(f"Found {len(blocks)} postgres_changes blocks in use-repair-realtime.ts\n")

for i, b in enumerate(blocks):
    table_m = re.search(r'table:\s*["\']([^"\']+)["\']', b)
    event_m = re.search(r'event:\s*["\']([^"\']+)["\']', b)
    filter_m = re.search(r'filter:\s*[`"\']([^`"\']+)[`"\']', b)
    
    table = table_m.group(1) if table_m else 'unknown'
    event = event_m.group(1) if event_m else '*'
    filt = filter_m.group(1) if filter_m else 'NONE'
    
    # check for payload usage
    uses_new = 'payload.new' in b or '.new' in b
    uses_old = 'payload.old' in b or '.old' in b
    
    print(f"[{i+1}] Table: {table} | Event: {event} | Filter: {filt}")
    print(f"    Payload usage: uses_new={uses_new}, uses_old={uses_old}")
    # print snippet of callback
    cb = b.split('=>')[-1].strip()[:200].replace('\n', ' ')
    print(f"    Callback preview: {cb}...")
    print()
