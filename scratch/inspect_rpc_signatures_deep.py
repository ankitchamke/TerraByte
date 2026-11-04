import re

# 1. Read forward migration A
with open("supabase/migrations/20261104110000_complete_phase9_parts_desk_rpcs.sql", "r", encoding="utf-8") as f:
    mig_a = f.read()

# 2. Read quotes services
with open("src/lib/services/quotes.ts", "r", encoding="utf-8") as f:
    quotes_code = f.read()

# 3. Read parts-desk services
with open("src/lib/services/parts-desk.ts", "r", encoding="utf-8") as f:
    parts_code = f.read()

# Extract CREATE OR REPLACE FUNCTION signatures from migration A
fn_matches = re.findall(r"CREATE OR REPLACE FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS\s+([a-zA-Z0-9_]+)", mig_a)

print("=== MIGRATION A DATABASE FUNCTION SIGNATURES ===")
for name, params, ret in fn_matches:
    cleaned_params = " ".join(params.split())
    print(f"Function: public.{name}")
    print(f"  Params: {cleaned_params}")
    print(f"  Returns: {ret}\n")

print("=== FRONTEND CALL SITES IN parts-desk.ts ===")
# Search for rpc calls in parts-desk.ts
matches = re.finditer(r'\(supabase\.rpc\s+as\s+[^)]+\)\(\s*["\']([^"\']+)["\'],\s*(\{[\s\S]*?\})\s*\)', parts_code)
for m in matches:
    rpc_name = m.group(1)
    args_block = " ".join(m.group(2).split())
    print(f"RPC Call: {rpc_name}")
    print(f"  Args: {args_block}\n")

# Check quotes.ts rpc calls
print("=== FRONTEND CALL SITES IN quotes.ts ===")
q_matches = re.finditer(r'supabase\.rpc\(\s*["\']([^"\']+)["\'],\s*(\{[\s\S]*?\})\s*\)', quotes_code)
for m in q_matches:
    rpc_name = m.group(1)
    args_block = " ".join(m.group(2).split())
    print(f"RPC Call: {rpc_name}")
    print(f"  Args: {args_block}\n")
