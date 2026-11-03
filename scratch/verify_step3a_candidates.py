import os
import re
import hashlib
import json

candidates = [
    '20261001151000',
    '20261001151200',
    '20261001153500',
    '20261001163000',
    '20261001170000',
    '20261002000000',
    '20261004100000',
    '20261005100000',
    '20261006100000',
    '20261006110000',
    '20261102100000',
    '20261103110000'
]

mig_dir = 'supabase/migrations'
all_files = sorted(os.listdir(mig_dir))

candidate_details = {}

for c in candidates:
    fn = [f for f in all_files if f.startswith(c)][0]
    fp = os.path.join(mig_dir, fn)
    with open(fp, 'rb') as f:
        data = f.read()
    h = hashlib.sha256(data).hexdigest()
    sz = len(data)
    text = data.decode('utf-8')
    
    # Extract defined objects
    funcs = re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)', text, re.IGNORECASE)
    tables = re.findall(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)', text, re.IGNORECASE)
    triggers = re.findall(r'CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)', text, re.IGNORECASE)
    policies = re.findall(r'CREATE\s+POLICY\s+"([^"]+)"', text, re.IGNORECASE)
    cols = re.findall(r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)', text, re.IGNORECASE)
    indexes = re.findall(r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)', text, re.IGNORECASE)
    
    candidate_details[c] = {
        'filename': fn,
        'sha256': h,
        'size': sz,
        'functions': list(set(funcs)),
        'tables': list(set(tables)),
        'triggers': list(set(triggers)),
        'policies': list(set(policies)),
        'columns': list(set(cols)),
        'indexes': list(set(indexes)),
    }

print("Loaded all 12 candidates successfully.")

# Now, check later migrations for any alterations/drops of these objects
# Later migrations are any migrations with timestamp > c
for c, det in candidate_details.items():
    later_files = [f for f in all_files if f > c]
    superseding_info = []
    
    for lf in later_files:
        with open(os.path.join(mig_dir, lf), 'r', encoding='utf-8') as f:
            ltext = f.read()
            
        for fn_name in det['functions']:
            if f'DROP FUNCTION' in ltext and fn_name in ltext:
                superseding_info.append(f'Function {fn_name} dropped in {lf}')
            elif f'CREATE OR REPLACE FUNCTION' in ltext and fn_name in ltext:
                superseding_info.append(f'Function {fn_name} replaced in {lf}')
                
        for t_name in det['tables']:
            if f'DROP TABLE' in ltext and t_name in ltext:
                superseding_info.append(f'Table {t_name} dropped in {lf}')
                
        for p_name in det['policies']:
            if f'DROP POLICY' in ltext and p_name in ltext:
                superseding_info.append(f'Policy "{p_name}" dropped in {lf}')

    det['superseded_by'] = superseding_info

with open('scratch/candidate_verification.json', 'w') as out:
    json.dump(candidate_details, out, indent=2)

print("Saved verification to scratch/candidate_verification.json")
