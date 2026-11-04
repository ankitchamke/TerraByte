import os
import re
import json

BASELINE_PATH = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_schema.sql"

if not os.path.exists(BASELINE_PATH):
    print(f"ERROR: {BASELINE_PATH} does not exist!")
    exit(1)

with open(BASELINE_PATH, "r", encoding="utf-8", errors="replace") as f:
    lines = f.readlines()

content = "".join(lines)
total_lines = len(lines)
total_bytes = os.path.getsize(BASELINE_PATH)

print(f"Auditing Baseline DDL: {BASELINE_PATH}")
print(f"Lines: {total_lines}, Size: {total_bytes} bytes")

# 1. Check for DML / data rows
data_statements = []
for i, line in enumerate(lines):
    line_upper = line.strip().upper()
    if line_upper.startswith("INSERT INTO") or line_upper.startswith("COPY ") or line_upper.startswith(r"\COPY"):
        data_statements.append((i + 1, line.strip()))

# 2. Check for PII / Emails / Phones / Passwords
email_regex = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
phone_regex = re.compile(r"(?:\+91|0)?[6-9]\d{9}")
bcrypt_regex = re.compile(r"\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}")
jwt_regex = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")

emails_found = []
phones_found = []
bcrypts_found = []
jwts_found = []

for i, line in enumerate(lines):
    # filter out routine comments or doc references if any
    for em in email_regex.findall(line):
        emails_found.append((i + 1, em))
    for ph in phone_regex.findall(line):
        phones_found.append((i + 1, ph))
    for bc in bcrypt_regex.findall(line):
        bcrypts_found.append((i + 1, bc))
    for jw in jwt_regex.findall(line):
        jwts_found.append((i + 1, jw))

# 3. Check for Project Refs / URLs / Secrets
prod_ref = "hwdrypkvszwrcraujctw"
stag_ref = "ubqgvhcfmrvnmrbllcom"
supabase_url = ".supabase.co"

prod_refs_found = [(i + 1, l.strip()) for i, l in enumerate(lines) if prod_ref in l]
stag_refs_found = [(i + 1, l.strip()) for i, l in enumerate(lines) if stag_ref in l]
urls_found = [(i + 1, l.strip()) for i, l in enumerate(lines) if supabase_url in l]

# 4. Check Functions and Security Properties
# Regex for CREATE [OR REPLACE] FUNCTION ...
func_blocks = re.findall(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\"a-zA-Z0-9_.]+)\s*\((.*?)\)\s+RETURNS\s+(.*?)\s+(?:LANGUAGE\s+([a-zA-Z0-9_]+)\s+)?(.*?)(?=\n\n|\nCREATE|\Z)",
    content,
    re.DOTALL | re.IGNORECASE
)

# Detailed function analysis
functions_analyzed = []
func_pattern = re.compile(r"CREATE FUNCTION ([\"a-zA-Z0-9_.]+)\s*\((.*?)\)\s+RETURNS\s+(.*?)\n(.*?)AS \$\$(.*?)\$\$;", re.DOTALL)
for match in func_pattern.finditer(content):
    func_name = match.group(1).replace('"', '')
    args = match.group(2).strip()
    returns = match.group(3).strip()
    modifiers = match.group(4)
    body = match.group(5)

    is_security_definer = "SECURITY DEFINER" in modifiers.upper() or "SECURITY DEFINER" in body.upper()
    has_search_path = "SEARCH_PATH" in modifiers.upper() or "SEARCH_PATH" in body.upper()

    # extract search path if present
    sp_match = re.search(r"SET\s+search_path\s*=\s*([^;\n]+)", modifiers + body, re.IGNORECASE)
    search_path_val = sp_match.group(1).strip() if sp_match else "NONE"

    functions_analyzed.append({
        "name": func_name,
        "args": args,
        "returns": returns,
        "is_security_definer": is_security_definer,
        "has_search_path": has_search_path,
        "search_path": search_path_val,
        "has_auth_uid": "auth.uid()" in body,
        "has_auth_jwt": "auth.jwt()" in body
    })

# 5. Inventory of Tables, Types, Triggers, Policies, Grants, Ownership
tables = re.findall(r"CREATE TABLE [\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s*\(", content, re.IGNORECASE)
types = re.findall(r"CREATE TYPE [\"public\"]*\.?[\"]*([a-zA-Z0-9_]+)[\"]*\s+AS ENUM", content, re.IGNORECASE)
triggers = re.findall(r"CREATE TRIGGER [\"a-zA-Z0-9_.]+ ON [\"a-zA-Z0-9_.]+", content, re.IGNORECASE)
policies = re.findall(r"CREATE POLICY [\"a-zA-Z0-9_ .]+ ON [\"a-zA-Z0-9_.]+", content, re.IGNORECASE)
grants = re.findall(r"GRANT [a-zA-Z0-9_ ,]+ ON (?:TABLE|FUNCTION|SCHEMA|SEQUENCE) [\"a-zA-Z0-9_.]+ TO [a-zA-Z0-9_ ,]+", content, re.IGNORECASE)
ownerships = re.findall(r"ALTER (?:TABLE|FUNCTION|TYPE|SCHEMA) [\"a-zA-Z0-9_.]+ OWNER TO [a-zA-Z0-9_]+", content, re.IGNORECASE)

# 6. External Schema Dependencies (auth, storage, extensions)
auth_refs = set(re.findall(r"\bauth\.([a-zA-Z0-9_]+)", content, re.IGNORECASE))
storage_refs = set(re.findall(r"\bstorage\.([a-zA-Z0-9_]+)", content, re.IGNORECASE))
extensions = re.findall(r"CREATE EXTENSION [^;]+;", content, re.IGNORECASE)

report = {
    "file": BASELINE_PATH,
    "size_bytes": total_bytes,
    "lines_count": total_lines,
    "data_statements_count": len(data_statements),
    "data_statements": data_statements,
    "pii_audit": {
        "emails": emails_found,
        "phones": phones_found,
        "bcrypt_hashes": bcrypts_found,
        "jwts": jwts_found
    },
    "project_refs_audit": {
        "production_refs": prod_refs_found,
        "staging_refs": stag_refs_found,
        "supabase_urls": urls_found
    },
    "object_inventory": {
        "tables_count": len(tables),
        "tables": sorted(list(set(tables))),
        "enums_count": len(types),
        "enums": sorted(list(set(types))),
        "triggers_count": len(triggers),
        "policies_count": len(policies),
        "grants_count": len(grants),
        "ownerships_count": len(ownerships)
    },
    "functions_count": len(functions_analyzed),
    "functions": functions_analyzed,
    "dependencies": {
        "auth_schema_objects": sorted(list(auth_refs)),
        "storage_schema_objects": sorted(list(storage_refs)),
        "extensions": extensions
    }
}

with open("scratch/baseline_security_audit_results.json", "w") as f:
    json.dump(report, f, indent=2)

print("\nAudit complete! Summary:")
print(f"  Data Rows (INSERT/COPY): {len(data_statements)}")
print(f"  Emails Found: {len(emails_found)}")
print(f"  Phones Found: {len(phones_found)}")
print(f"  Bcrypt Hashes: {len(bcrypts_found)}")
print(f"  JWT Tokens: {len(jwts_found)}")
print(f"  Production Project Refs: {len(prod_refs_found)}")
print(f"  Staging Project Refs: {len(stag_refs_found)}")
print(f"  Supabase URLs: {len(urls_found)}")
print(f"  Tables: {len(tables)}, Enums: {len(types)}, Triggers: {len(triggers)}, Policies: {len(policies)}")
print(f"  Functions Analyzed: {len(functions_analyzed)}")
print(f"  Auth References: {sorted(list(auth_refs))}")
print(f"  Storage References: {sorted(list(storage_refs))}")
