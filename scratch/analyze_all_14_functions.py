import json
import re

with open(r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql", encoding="utf-8") as f:
    sql = f.read()

# Find all CREATE FUNCTION ... AS $$ ... $$;
pattern = re.compile(
    r"CREATE FUNCTION ([\"a-zA-Z0-9_.]+)\s*\((.*?)\)\s+RETURNS\s+(.*?)\n(.*?)AS \$\$(.*?)\$\$;",
    re.DOTALL
)

print(f"{'Function Name':<42} | {'Security':<8} | {'Search Path':<35} | {'Auth Checks'}")
print("-" * 115)

for match in pattern.finditer(sql):
    name = match.group(1).replace('"', '')
    args = match.group(2).strip()
    returns = match.group(3).strip()
    header = match.group(4)
    body = match.group(5)

    is_definer = "SECURITY DEFINER" in header
    sec = "DEFINER" if is_definer else "INVOKER"

    sp_match = re.search(r"SET search_path = ([^;\n]+)", header, re.IGNORECASE)
    sp = sp_match.group(1).strip() if sp_match else "MISSING / NONE"

    auth_checks = []
    if "auth.uid()" in body:
        auth_checks.append("auth.uid()")
    if "auth.jwt()" in body:
        auth_checks.append("auth.jwt()")
    if "clerk_user_id" in body:
        auth_checks.append("clerk_user_id")
    if "v_caller_role" in body or "user_role" in body:
        auth_checks.append("role_check")
    if "RAISE EXCEPTION 'Forbidden" in body or "RAISE EXCEPTION 'Unauthorized" in body or "RAISE EXCEPTION 'Authentication required" in body:
        auth_checks.append("forbidden_guard")

    auth_str = ", ".join(auth_checks) if auth_checks else "NONE"
    print(f"{name:<42} | {sec:<8} | {sp:<35} | {auth_str}")
