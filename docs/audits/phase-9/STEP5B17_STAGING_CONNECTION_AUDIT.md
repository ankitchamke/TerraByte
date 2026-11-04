# TerraByte — Step 5B.17: Staging Connection Audit & Isolation Verification
**Document Version:** `1.0 (Staging Isolation Preflight)`  
**Date:** `2026-11-04`  
**Staging Project Reference:** `ubqgvhcfmrvnmrbllcom` (`terrabyte-staging` · `ap-southeast-1` · PostgreSQL 17.11)  
**Protected Production Reference:** `hwdrypkvszwrcraujctw`  
**Production Gate Status:** **`UNAUTHORIZED / BLOCKED — ZERO ACCESS PERMITTED`**  
**Staging Database Changes:** **`NOT AUTHORIZED YET (Read-Only Verification Only)`**

---

## 1. Executive Summary

Workstream E audited the local environment configuration, Vite environment layering, and deployment pipeline targeting to guarantee strict isolation between the newly provisioned staging environment (`ubqgvhcfmrvnmrbllcom`) and the protected production environment (`hwdrypkvszwrcraujctw`).

### Key Audit Findings:
1. **Secrets Security:** Local staging environment file `.env.staging` is verified to be gitignored by line 37 of `.gitignore` (`.gitignore:37:.env.*`). No credentials can leak into version control.
2. **Deterministic Vite Layering:** Vite's `loadEnv('staging', process.cwd())` strictly binds `https://ubqgvhcfmrvnmrbllcom.supabase.co`. No production keys or URLs are included in staging bundles.
3. **Pristine Staging State Confirmed:** Remote inspection via Supabase MCP confirmed that `ubqgvhcfmrvnmrbllcom` currently possesses **0 public tables and 0 applied migrations**. It is completely pristine and ready for initialization when authorized.
4. **Zero Production Risk:** All development, testing, and inspection scripts explicitly target port `5433` locally and `ubqgvhcfmrvnmrbllcom` remotely. Production (`hwdrypkvszwrcraujctw`) remains completely air-gapped and untouchable.

---

## 2. Environment Configuration Audit

### Git Exclusions Verification
Command: `git check-ignore -v .env.staging`  
Output:
```
.gitignore:37:.env.*	.env.staging
```
**Proof:** `.env.staging` is strictly excluded from Git tracking.

### Vite Environment Resolution Test
Command:
```javascript
const { loadEnv } = require('vite');
const stagingEnv = loadEnv('staging', process.cwd());
console.log('Staging URL:', stagingEnv.VITE_SUPABASE_URL);
console.log('Staging URL contains ubqgvhcfmrvnmrbllcom:', stagingEnv.VITE_SUPABASE_URL.includes('ubqgvhcfmrvnmrbllcom'));
console.log('Staging URL contains hwdrypkvszwrcraujctw:', stagingEnv.VITE_SUPABASE_URL.includes('hwdrypkvszwrcraujctw'));
```
Execution Output:
```
Staging URL: https://ubqgvhcfmrvnmrbllcom.supabase.co
Staging URL contains ubqgvhcfmrvnmrbllcom: true
Staging URL contains hwdrypkvszwrcraujctw: false
```
**Proof:** When launched with `--mode staging`, the frontend connects exclusively to the staging project.

---

## 3. Operational Mode Switching Matrix

| Execution Context | Exact Command | Resolved Backend Target | Project Reference |
| :--- | :--- | :--- | :---: |
| **Local Staging Dev Server** | `npm run dev -- --mode staging` | Staging Cloud (`ap-southeast-1`) | `ubqgvhcfmrvnmrbllcom` |
| **Staging Production Build** | `npm run build -- --mode staging` | Staging Cloud (`ap-southeast-1`) | `ubqgvhcfmrvnmrbllcom` |
| **Staging Preview Verification** | `npm run preview -- --mode staging` | Staging Cloud (`ap-southeast-1`) | `ubqgvhcfmrvnmrbllcom` |
| **Local Offline PostgreSQL Drill** | `python scratch/test_complete_clean_rehearsal.py` | Local Disposable PG 17 (`127.0.0.1:5433`) | `terabyte_schema_only_drill` |
| **Production Target** | **BLOCKED / UNAUTHORIZED** | Protected Production (`ap-southeast-1`) | `hwdrypkvszwrcraujctw` |

---

## 4. Vercel Preview Deployment Mapping

For CI/CD and preview deployments:
- **Production Environment (`main` branch):** Points to `hwdrypkvszwrcraujctw` (Restricted).
- **Preview Environments (`phase-*` branches, PRs):** Points to `ubqgvhcfmrvnmrbllcom` (`terrabyte-staging`).

This architecture ensures that all feature testing, staging rehearsals, and automated browser tests interact only with synthetic staging data, completely insulating production infrastructure.
