import re
import os

migs = [
    "supabase/migrations/20261104100000_profile_security_separation.sql",
    "supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql",
    "supabase/migrations/20261104120000_complete_phase9_realtime_and_eta.sql",
    "supabase/migrations/20261104130000_complete_phase5_3_technician_registration_notification.sql"
]

print(f"{'Migration':<30} | {'Function Name':<42} | {'Security':<8} | {'Search Path'}")
print("-" * 115)

for mig in migs:
    fname = os.path.basename(mig)
    with open(mig, encoding="utf-8") as f:
        sql = f.read()

    # Match CREATE OR REPLACE FUNCTION name(...) RETURNS ... LANGUAGE ... AS $$
    pattern = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_.]+)\s*\((.*?)\)\s+RETURNS\s+(.*?)\s+(LANGUAGE\s+[a-zA-Z0-9_]+.*?)(?:AS\s+\$\$|AS\s+'|BEGIN)",
        re.DOTALL | re.IGNORECASE
    )

    for m in pattern.finditer(sql):
        fn_name = m.group(1)
        header = m.group(4)
        sp_match = re.search(r"SET\s+search_path\s*=\s*([^;\n]+)", header, re.IGNORECASE)
        sp = sp_match.group(1).strip() if sp_match else "MISSING / NONE"
        sec = "DEFINER" if "SECURITY DEFINER" in header.upper() else "INVOKER"
        print(f"{fname[:28]:<30} | {fn_name:<42} | {sec:<8} | {sp}")
