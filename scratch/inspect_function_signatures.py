import re

files = [
    ("Migration A", "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql"),
    ("Migration B", "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql"),
    ("Migration C", "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql")
]

for label, path in files:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"\n=================== {label} ===================")
    # Find functions
    func_matches = re.finditer(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\((.*?)\)\s*RETURNS\s+(.*?)\s+(?:LANGUAGE|SECURITY|SET)", content, re.DOTALL | re.IGNORECASE)
    for m in func_matches:
        name = m.group(1)
        raw_args = m.group(2).strip()
        returns = m.group(3).strip()
        # Parse argument types for identity signature
        # Arguments can be: p_arg type, p_arg2 type = default
        arg_types = []
        if raw_args:
            # Split arguments by comma (handling nested structures if any)
            # Simplistic split by comma
            args = [a.strip() for a in raw_args.split(",") if a.strip()]
            for a in args:
                # get words
                words = a.split()
                # word 0 is param name (e.g. p_request_id), word 1 is param type (e.g. uuid)
                # or in case of trigger function, no args
                if len(words) >= 2:
                    arg_type = words[1].split("=")[0].strip()
                    arg_types.append(arg_type)
                elif len(words) == 1:
                    arg_types.append(words[0])
        sig = f"public.{name}({', '.join(arg_types)})"
        print(f"Function: {sig} -> RETURNS {returns}")
    
    # Also find all REVOKE / GRANT lines
    print("--- Permissions: ---")
    for line in content.split("\n"):
        if line.strip().startswith("REVOKE") or line.strip().startswith("GRANT"):
            print("  " + line.strip())
