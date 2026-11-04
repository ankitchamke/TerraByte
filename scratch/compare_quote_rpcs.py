import re

with open('supabase/migrations/20261031170000_phase9_2_quote_catalog_and_inventory.sql', 'r', encoding='utf-8') as f:
    text_1700 = f.read()

with open('supabase/migrations/20261031183000_phase9_3_realtime_publications.sql', 'r', encoding='utf-8') as f:
    text_1830 = f.read()

with open('supabase/migrations/20261101140000_phase9_3_unavailable_parts_eta.sql', 'r', encoding='utf-8') as f:
    text_1400 = f.read()

def extract_func(text, name):
    m = re.search(rf'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?{name}\s*\(.*?\)\s*RETURNS\s+.*?\s+LANGUAGE\s+\w+\s+.*?\$function\$(.*?)\$function\$;', text, re.DOTALL | re.I)
    if not m:
        m = re.search(rf'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?{name}\s*\(.*?\)\s*RETURNS\s+.*?\s+LANGUAGE\s+\w+\s+.*?\$\$(.*?)\$\$;', text, re.DOTALL | re.I)
    return m.group(1).strip() if m else None

q_1700 = extract_func(text_1700, 'create_quote_atomic')
q_1830 = extract_func(text_1830, 'create_quote_atomic')
q_1400 = extract_func(text_1400, 'create_quote_atomic')

print(f"create_quote_atomic len: 1700={len(q_1700 or '')}, 1830={len(q_1830 or '')}, 1400={len(q_1400 or '')}")

rev_1700 = extract_func(text_1700, 'revise_quote_atomic')
rev_1830 = extract_func(text_1830, 'revise_quote_atomic')

print(f"revise_quote_atomic len: 1700={len(rev_1700 or '')}, 1830={len(rev_1830 or '')}")

with open('scratch/create_quote_1700.sql', 'w', encoding='utf-8') as f: f.write(q_1700 or '')
with open('scratch/create_quote_1830.sql', 'w', encoding='utf-8') as f: f.write(q_1830 or '')
with open('scratch/create_quote_1400.sql', 'w', encoding='utf-8') as f: f.write(q_1400 or '')
with open('scratch/revise_quote_1700.sql', 'w', encoding='utf-8') as f: f.write(rev_1700 or '')
with open('scratch/revise_quote_1830.sql', 'w', encoding='utf-8') as f: f.write(rev_1830 or '')
