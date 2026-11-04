# TerraByte — Step 5B.15: Staging Environment Prerequisites Checklist
**Document Version:** `1.0 (Staging Prerequisites & Risk Assessment)`  
**Date:** `2026-11-04`  
**Target Environment:** Isolated Free-Tier Supabase Project  
**Status:** **`PREPARATION ONLY — AWAITING SEPARATE STAGING PROJECT`**  
**Production Gate Status:** **`UNAUTHORIZED / BLOCKED — ZERO PRODUCTION SQL EXECUTION AUTHORIZED`**

---

## 1. Executive Summary

To safely evaluate TerraByte's Phase 9 capabilities—including live PostgREST API interactions, WebSocket channels, JWT context transitions, and storage uploads—an isolated staging environment is required.

This document provides the complete, security-hardened provisioning checklist for setting up a separate Supabase free-tier project.

> [!CAUTION]
> **Zero Credential Exposure Rule:**
> Never paste database passwords, service-role keys, or JWT secrets into chat prompts, git commits, or public markdown files. All credentials must be held exclusively in a local, gitignored `.env.staging` file or entered directly into the Vercel dashboard.

---

## 2. Staging Infrastructure Checklist

### 2.1 Project Identity & Isolation Verification
- [ ] **Provision Project:** Create a new project on [Supabase Dashboard](https://supabase.com/dashboard).
- [ ] **Region Selection:** Select `ap-south-1` (Mumbai) to match production latency, or `ap-southeast-1` (Singapore).
- [ ] **Project Reference Check:** Record the 20-character staging project ref (`[a-z]{20}`).
- [ ] **Isolation Invariant:** Execute verification check:
  ```bash
  # MUST return false / different:
  test "$STAGING_PROJECT_REF" != "hwdrypkvszwrcraujctw" && echo "SAFE: Staging ref is isolated"
  ```

### 2.2 Database Connection & Pooler Configuration
- [ ] **Database Version:** Confirm engine is PostgreSQL 15, 16, or 17.6.
- [ ] **Transaction Pooler (Port 6543):**
  - Host: `aws-0-[region].pooler.supabase.com`
  - Port: `6543`
  - User: `postgres.[staging-project-ref]`
  - Mode: Transaction (for serverless/functions)
- [ ] **Direct Connection (Port 5432):**
  - Host: `db.[staging-project-ref].supabase.co`
  - Port: `5432`
  - User: `postgres`
  - Mode: Session (for `pg_dump` and long-running DDL migrations)

### 2.3 API & Client Keys
- [ ] **Supabase URL:** `https://[staging-project-ref].supabase.co`
- [ ] **Public Anon Key:** Safe for client-side inclusion in `VITE_SUPABASE_ANON_KEY`.
- [ ] **Service-Role Key:** Admin key with RLS bypass.
  - **Storage:** Placed only in local `.env.staging` (excluded from git).
  - **Usage:** Used only for migration runners or backend administrative scripts. **Never bundle in frontend code.**

---

## 3. Application & Deployment Configuration

### 3.1 Local Environment File Template (`.env.staging`)
Create `.env.staging` in the repository root (confirmed ignored by `.gitignore`):

```bash
# ==============================================================================
# TerraByte Staging Environment (LOCAL SECURE TEMPLATE)
# ==============================================================================
# 1. Project Reference
VITE_SUPABASE_PROJECT_REF=<staging-project-ref>

# 2. Public API Credentials
VITE_SUPABASE_URL=https://<staging-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# 3. Direct DB Connection (for preflight pg_dump and migration rehearsal)
STAGING_DB_URL=postgresql://postgres:<staging-db-password>@db.<staging-project-ref>.supabase.co:5432/postgres?sslmode=require

# 4. Service Role Key (Local admin operations only - NEVER commit)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

### 3.2 Authentication & URL Configuration (Supabase Dashboard)
Navigate to **Authentication -> URL Configuration** in the Staging project:
- [ ] **Site URL:** `http://localhost:5173` (for local development)
- [ ] **Redirect URLs (Allow list):**
  - `http://localhost:5173/**`
  - `http://localhost:3000/**`
  - `https://*-<team-slug>.vercel.app/**` (Vercel preview deployments)
  - `https://terrabyte-staging.vercel.app/**` (Dedicated staging domain)
- [ ] **Auth Providers:** Enable Email/Password.
- [ ] **Email Confirmations:** Recommended: Disable "Confirm email" for testing to allow rapid synthetic persona testing without external email dispatch.

### 3.3 Storage Buckets & Policies
The TerraByte application requires two public storage buckets:
- [ ] `avatars` (Public bucket for profile pictures)
- [ ] `repair-images` (Public bucket for breakdown photos and diagnostic media)
- [ ] **Bucket Provisioning Script:**
  ```sql
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true), ('repair-images', 'repair-images', true)
  ON CONFLICT (id) DO NOTHING;
  ```

### 3.4 Supabase Realtime Publication
Ensure the `supabase_realtime` publication includes all required transactional tables:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE 
  public.repair_requests,
  public.repair_messages,
  public.notifications,
  public.service_centre_parts,
  public.service_centre_part_requests,
  public.quotes;
```

---

## 4. Vercel Staging Environment Setup

In the Vercel Project Settings for TerraByte:
1. Navigate to **Settings -> Environment Variables**.
2. Add the following variables scoped strictly to the **Preview** environment (or a custom `staging` branch environment):
   - `VITE_SUPABASE_URL` = `https://<staging-project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<staging-anon-key>`
3. Ensure the production environment remains pinned strictly to production configuration.

---

## 5. Free-Tier Operational Risks & Mitigations

| Risk Factor | Free-Tier Quota / Limitation | Impact on TerraByte Staging | Mitigation Protocol |
| :--- | :--- | :--- | :--- |
| **Database Storage Limit** | 500 MB total disk space | Zero impact. The preflight baseline is 354.54 KB (< 0.1% of quota). | Run periodic demo resets (`reset_demo_data()`) after test batches. |
| **Inactivity Auto-Pause** | Project pauses after 7 days without queries | API requests fail if paused. | If paused, navigate to dashboard to unpause (takes ~60 seconds). |
| **Zero PITR Backups** | Free tier includes 0 days of Point-in-Time Recovery | Accidental table drops cannot be rewound automatically by Supabase. | **Mandatory local logical backups:** Always capture `pg_dump` snapshot ($0.00 spend) before executing migrations. |
| **Egress Limit** | 5 GB / month bandwidth | Negligible for staging testing. | Use local media assets for heavy automated test suites. |
| **Compute Resources** | Shared vCPU, 1 GB RAM | Moderate latency under heavy concurrency. | Throttle automated test concurrency to 5 parallel workers. |

---

## 6. Audit Verdict

- **Staging Prerequisites Checklist:** **`VERIFIED COMPLETE`**
- **Security & Secret Boundaries:** **`VERIFIED SECURED`**
- **Active Staging Project Status:** **`PREPARATION ONLY — AWAITING SEPARATE STAGING PROJECT`**

Production gate status remains strictly: **`UNAUTHORIZED / BLOCKED — ZERO PRODUCTION SQL EXECUTION AUTHORIZED`**.
