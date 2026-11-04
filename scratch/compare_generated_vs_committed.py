import re
import json

with open("scratch/generated_types_from_local_pg.ts", "r", encoding="utf-8") as f:
    gen_text = f.read()

with open("src/integrations/supabase/types.ts", "r", encoding="utf-8") as f:
    committed_text = f.read()

rpcs = [
    "confirm_service_centre_part_handoff",
    "adjust_service_centre_part_stock",
    "receive_service_centre_stock",
    "return_service_centre_part",
    "request_service_centre_part",
    "update_service_centre_part_request_eta",
    "create_quote_atomic",
    "revise_quote_atomic"
]

print("=== RPC Comparison: Generated from PG Catalog vs Committed types.ts ===")
for fn in rpcs:
    # search generated
    m_gen = re.search(rf'\"{fn}\":\s*{{(.*?)Returns:\s*([a-zA-Z0-9_\[\]]+)', gen_text, re.DOTALL)
    # search committed
    m_com = re.search(rf'{fn}:\s*{{(.*?)Returns:\s*([a-zA-Z0-9_\[\]]+)', committed_text, re.DOTALL)
    
    print(f"\n--- {fn} ---")
    if m_gen:
        gen_args = re.sub(r'\s+', ' ', m_gen.group(1)).strip()
        print(f"  [Generated from PG]: {gen_args} -> {m_gen.group(2)}")
    else:
        print(f"  [Generated from PG]: NOT FOUND")
        
    if m_com:
        com_args = re.sub(r'\s+', ' ', m_com.group(1)).strip()
        print(f"  [Committed types.ts]: {com_args} -> {m_com.group(2)}")
    else:
        print(f"  [Committed types.ts]: NOT FOUND")
