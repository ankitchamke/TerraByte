import re

with open('src/hooks/use-repair-realtime.ts', 'r', encoding='utf-8') as f:
    text = f.read()

events = re.findall(r'postgres_changes[\s\S]*?table:\s*["\']([^"\']+)["\']', text)
print("Subscribed postgres_changes in use-repair-realtime.ts:")
for t in set(events):
    print(f"  - {t}")

with open('src/components/repair-chat.tsx', 'r', encoding='utf-8') as f:
    chat_text = f.read()

chat_events = re.findall(r'postgres_changes[\s\S]*?table:\s*["\']([^"\']+)["\']', chat_text)
print("Subscribed postgres_changes in repair-chat.tsx:")
for t in set(chat_events):
    print(f"  - {t}")

with open('src/lib/services/parts-desk.ts', 'r', encoding='utf-8') as f:
    pd_text = f.read()

pd_broadcasts = re.findall(r'channel\(["\']([^"\']+)["\']\)[\s\S]*?event:\s*["\']([^"\']+)["\']', pd_text)
print("Broadcast channels & events in parts-desk.ts:")
for ch, ev in set(pd_broadcasts):
    print(f"  - Channel: '{ch}', Event: '{ev}'")
