import re

auth_data_path = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_auth_data.sql"
public_data_path = r"D:\TerraByte_Backups\production_backup_20261103_151328\terabyte_public_data.sql"

print("--- Inspecting Auth Data ---")
with open(auth_data_path, "r", encoding="utf-8") as f:
    auth_lines = f.readlines()

in_users = False
for line in auth_lines:
    if line.startswith('COPY "auth"."users"'):
        in_users = True
        continue
    if in_users and line.strip() == r"\.":
        in_users = False
        continue
    if in_users:
        parts = line.split("\t")
        if len(parts) > 4:
            user_id = parts[1] if len(parts) > 1 else ""
            email = parts[4] if len(parts) > 4 else ""
            encrypted_password = parts[5] if len(parts) > 5 else ""
            print(f"User ID: {user_id[:8]}... | Email: {email} | HasPasswordHash: {bool(encrypted_password)}")

print("\n--- Inspecting Public Profiles ---")
with open(public_data_path, "r", encoding="utf-8") as f:
    pub_lines = f.readlines()

in_profiles = False
for line in pub_lines:
    if 'COPY "public"."profiles"' in line:
        in_profiles = True
        continue
    if in_profiles and line.strip() == r"\.":
        in_profiles = False
        continue
    if in_profiles:
        parts = line.split("\t")
        print(f"Profile: {parts[:5]}")

print("\n--- Inspecting Public Notifications ---")
with open(public_data_path, "r", encoding="utf-8") as f:
    pub_lines = f.readlines()

in_notif = False
for line in pub_lines:
    if 'COPY "public"."notifications"' in line:
        in_notif = True
        continue
    if in_notif and line.strip() == r"\.":
        in_notif = False
        continue
    if in_notif:
        parts = line.split("\t")
        print(f"Notification: {parts[1:5]}")
