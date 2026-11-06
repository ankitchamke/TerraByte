# TerraByte — Production Security Remediation Plan & Approval Gates (Revised)

**Document ID:** TB-PLAN-2026-001-REV2  
**Phase:** Phase A.1 Acceptance & Remediation Planning  
**Auditor / Engineer:** Principal Infrastructure & Security Release Engineer  
**Date:** 2026-11-05  
**Status:** **REVISED REMEDIATION PLAN — AWAITING STAKEHOLDER APPROVAL**  
**Classification:** Technical Remediation Plan  

---

## Executive Summary

This remediation plan outlines the systematic security hardening of the TerraByte platform based on the foundational architecture clarification:

> [!IMPORTANT]
> **Architecture Invariant: Shared Testing Identities**  
> * Demo accounts (`farmer.nagpur@terrabyte.demo`, `tech.nagpur@terrabyte.demo`, `admin.nagpur@terrabyte.demo`) are **shared operational testing identities**, NOT isolated sandbox accounts.
> * They are intentionally designed to participate in cross-account workflows that involve real user accounts and real customer records.
> * **PostgreSQL Row-Level Security (RLS) policies will NOT be altered to isolate demo accounts from real records.**
> * All role-based workflows (farmer equipment breakdown reporting, technician mobile dispatch, service centre depot inventory and quote management) must be strictly preserved.
> * Zero paid services or external authentication vendors will be introduced.

This revised plan reflects the empirical realities discovered across the codebase: distinguishing between **hiding a credential** and **authorizing a caller**, accounting for **in-database base64 storage versus Supabase Storage**, and separating **local unit tests** from **remote production database state**.

---

## 1. Classification of Findings & Remediation Workstreams

Every finding is classified by its empirical verification level:
* **[SRC] Confirmed from source code**
* **[TST] Verified through local testing**
* **[REM] Verified against remote environment**
* **[RSK] Potential risk requiring verification**

---

### Workstream 1: Demo Credential Exposure in Frontend Bundles

#### A. Findings & Evidence
1. **Plaintext Passwords in Source Code [SRC]:**  
   Hardcoded plaintext demo passwords exist in [`src/routes/login.tsx`](file:///d:/Projects/TerraByte/src/routes/login.tsx#L190-L206) (lines 190, 198, 206) and [`src/routes/index.tsx`](file:///d:/Projects/TerraByte/src/routes/index.tsx#L254-L288) (lines 257, 271, 285) inside click handlers calling `fillAndSignIn(...)` and `handleDemoSignIn(...)`.
2. **Plaintext Credentials in Production Client Bundles [SRC]:**  
   Inspection of `.vercel/output/static/assets/` confirmed that `login-*.js`, `routes-*.js`, and `tb-*.js` contain the plaintext email addresses and password strings, making them trivially extractable via browser DevTools or automated scrapers.
3. **Documentation Sanitization [SRC] [TST]:**  
   Historical passwords in `.planning/TESTING.md`, `README.md`, and `PHASE_A1_LIVE_ACCEPTANCE_REPORT.md` have been sanitized to `[REDACTED]`. 160/160 automated tests pass locally.

#### B. Impact on Existing Testing Workflows
Evaluators, judges, and internal testers rely on the **1-click Quick Demo buttons** on `/login` and `/` to immediately test the platform without manual form entry or credential lookup.

#### C. Safest Remediation Approach
* Remove all static password literals from client-side source code (`src/routes/login.tsx`, `src/routes/index.tsx`).
* Store the demo password strictly in a serverless environment variable (`DEMO_AUTH_PASSWORD`), accessible only by server execution runtimes (Nitro/Vercel) and completely excluded from Vite client bundles.

---

### Workstream 2: Demo Authentication Broker & Caller Authorization

#### A. Findings & Evidence
1. **The Fallacy of `Sec-Fetch-Site` as Client Authentication [SRC]:**  
   `Sec-Fetch-Site: same-origin` is a browser-enforced header for CSRF mitigation in web browsers. It provides **zero authentication against non-browser clients**. Any HTTP client (`curl`, Python, Postman) can spoof it.
2. **Open Authentication Proxy Risk [RSK]:**  
   If `/api/demo-login` accepts `{ persona: "admin" }` without verifying caller entitlement, moving the password server-side only hides the secret string while keeping the capability open: an unauthenticated caller can invoke the endpoint and receive an authenticated Supabase administrative JWT directly.

#### B. Impact on Existing Testing Workflows
Testers must be able to switch personas in 1 click without entering one-time passwords, solving intrusive CAPTCHAs, or encountering disruptive authentication barriers.

#### C. Safest Remediation Approach
Implement **Alternative 1 (Evaluator Passphrase Gate)** or **Alternative 2 (Role-Tiered Broker)**:
* **Option 1: Evaluator Passphrase Gate (`DEMO_ACCESS_KEY`):**  
  The endpoint requires header `x-demo-key: <passphrase>`. Evaluators append `?demo_key=nagpur2026` to their browser URL once; client code caches this in `sessionStorage`. Subsequent 1-click buttons work instantly without prompts. Non-browser cURL scripts without the key are rejected with `401 Unauthorized`.
* **Option 2: Role-Tiered Broker (Farmer/Tech 1-Click, Admin Gated):**  
  `/api/demo-login` permits 1-click login for Farmer and Technician personas, but returns `403 Forbidden` for Admin unless an explicit administrative key is provided.

---

### Workstream 3: Storage Bucket Privacy & In-Database Base64 Architecture

#### A. Findings & Evidence
1. **Zero Client Uploads to Supabase Storage [SRC]:**  
   Codebase search confirms **zero occurrences** of `supabase.storage.from(...).upload(...)`. No files are currently uploaded to Supabase Storage by the application.
2. **In-Database Base64 Storage for User Media [SRC]:**  
   * **Farmer Breakdown Photos:** [`src/routes/farmer/report-breakdown.tsx`](file:///d:/Projects/TerraByte/src/routes/farmer/report-breakdown.tsx#L661) downscales photos via `fileToSmallDataUrl()` ([`src/lib/image.ts`](file:///d:/Projects/TerraByte/src/lib/image.ts#L2)) to canvas-compressed JPEG Data URLs (`data:image/jpeg;base64,...`), stored in `repair_requests.photos` (`text[]`).
   * **Equipment Photos:** [`src/routes/farmer/equipment/index.tsx`](file:///d:/Projects/TerraByte/src/routes/farmer/equipment/index.tsx#L198) downscales machine photos via `fileToSmallDataUrl()`, stored in `equipment.photo_url` (`text`).
   * **Technician Completion Photos:** [`src/routes/technician/job/$id.tsx`](file:///d:/Projects/TerraByte/src/routes/technician/job/$id.tsx#L2075) downscales proof photos via `fileToSmallDataUrl()`, stored in `repair_requests.completion_details -> photo` (`jsonb`).
   * **Phase 11 Visual Diagnostics:** [`src/routes/api/assess-visual-defect.ts`](file:///d:/Projects/TerraByte/src/routes/api/assess-visual-defect.ts#L203) reads base64 strings from `repair_requests.photos` and passes them inline to Google Gemini 3.5 Flash-Lite.
3. **Public Storage Buckets & Email Brand Asset [SRC]:**  
   [`supabase/migrations/20260930000002_storage_setup.sql`](file:///d:/Projects/TerraByte/supabase/migrations/20260930000002_storage_setup.sql) defines `equipment-media` and `repair-media` with `public = true`. The only active file is the brand logo used in signup and password reset emails ([`supabase/templates/confirm_signup.html`](file:///d:/Projects/TerraByte/supabase/templates/confirm_signup.html)).
4. **Dormant `breakdown-photos` Reference [SRC]:**  
   [`src/components/image-lightbox.tsx`](file:///d:/Projects/TerraByte/src/components/image-lightbox.tsx#L28) contains a fallback call to `supabase.storage.from("breakdown-photos").getPublicUrl(cleanPath)`. Because all active photos are `data:` URLs, this code path is dormant in practice.

#### B. Impact on Existing Testing Workflows
Making `equipment-media` private would break logo rendering in system emails. Altering photo storage away from base64 would require modifying image ingestion across 4 core workflows.

#### C. Safest Remediation Approach
1. **Retain In-Database Base64 User Media:** Photos remain protected by PostgreSQL RLS on `repair_requests` and `equipment`, completely isolated from anonymous storage scraping.
2. **Keep `equipment-media` Public for Email Brand Assets:** Preserves brand logo visibility in user notification emails.
3. **Revoke Anonymous Upload Policies:** Apply a forward migration to drop `"Anon users can upload demo media"` from `equipment-media` and `repair-media`.

---

### Workstream 4: Demo Data Reset Integrity (`reset_demo_data`)

#### A. Findings & Evidence
1. **Migration Source Code Inspection [SRC]:**  
   [`supabase/migrations/20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql`](file:///d:/Projects/TerraByte/supabase/migrations/20261031153000_phase9_3_safe_scoped_reset_demo_rpc.sql#L80-L119) verifies caller UID (`auth.uid()`), checks designated demo emails, checks `demo_code IS NOT NULL`, and scopes deletions strictly to Balasaheb Patil's equipment and repairs (`WHERE farmer_id = v_demo_farmer_id`). Real customer repairs are never matched.
2. **Local Automated Test Evidence [TST]:**  
   Verified by 73 passing unit tests in `tests/parts-desk.test.mjs`. Tests confirm regex matches for dual-key checks and safeupdate clauses.
3. **Remote Production Status [RSK]:**  
   **UNVERIFIED AGAINST REMOTE DB.** Under strict instructions, no destructive RPCs have been executed against production. If production `auth.users` IDs do not match the hardcoded fixture UUIDs (`00000000-...-0001`), the RPC will throw `42501 Unauthorized`. Local tests do NOT prove production execution.

#### B. Impact on Existing Testing Workflows
Resetting demo data is critical for resetting the Nagpur operational demo back to its baseline state after evaluator walkthroughs.

#### C. Safest Remediation Approach
* Retain the existing migration and unit tests.
* Do NOT execute `reset_demo_data()` against production during security reviews.
* Verify production user UUID mappings before executing any manual demo reset.

---

### Workstream 5: Staff Provisioning Guardrails (`admin_provision_staff`)

#### A. Findings & Evidence
1. **Migration Source Code Inspection [SRC]:**  
   [`supabase/migrations/20261104100000_profile_security_separation.sql`](file:///d:/Projects/TerraByte/supabase/migrations/20261104100000_profile_security_separation.sql#L310-L370) defines an RPC requiring `role = 'admin'`, restricting provisioning strictly to `role = 'technician'`, and setting `is_verified = false`.
2. **Local Automated Test Evidence [TST]:**  
   Verified by 23 passing tests in `tests/profile-security-architecture.test.mjs`.
3. **Remote Production Status [RSK]:**  
   **NOT DEPLOYED TO REMOTE DB.** Migration `20261104100000_profile_security_separation.sql` has not been applied to the remote production Supabase database (as evidenced by Phase A's `get_session_profile` missing RPC). Claiming this RPC currently protects production is false; it exists solely as an unapplied migration script.

#### B. Impact on Existing Testing Workflows
Admins must be able to invite and provision new local field technicians.

#### C. Safest Remediation Approach
* Maintain the migration definition and local test coverage.
* Defer remote deployment of `20261104100000_profile_security_separation.sql` to a planned database release window with proper schema backups.

---

### Workstream 6: Session Security & Concurrent Multi-Tester Behavior

#### A. Findings & Evidence
1. **Concurrent Session Support [REM]:**  
   Supabase Auth natively supports concurrent sessions for identical credentials across multiple browsers/devices.
2. **Independent Logout Isolation [REM]:**  
   Logging out on one browser clears that browser's local tokens and revokes only that specific session. It does NOT terminate sessions for concurrent evaluators.
3. **Token Lifespan [REM]:**  
   Supabase JWT access tokens naturally expire after 3600s (1 hour).

#### B. Impact on Existing Testing Workflows
Multiple evaluators and judges can simultaneously test the same demo accounts without kicking each other out.

#### C. Safest Remediation Approach
Retain native Supabase Auth session handling. Configure demo sessions issued by the broker with a standard 1-hour expiry.

---

### Workstream 7: Documentation Hygiene & Zero-Secret Invariant

#### A. Findings & Evidence
1. **Repository Secret Scrubbing [SRC] [TST]:**  
   All historical passwords in documentation files (`.planning/TESTING.md`, `README.md`, `PHASE_A1_LIVE_ACCEPTANCE_REPORT.md`) have been redacted to `[REDACTED]`.
2. **Pre-Commit Secret Scanner [TST]:**  
   `scratch/phase-a1/scan_commit_for_secrets.py` confirms zero active plaintext passwords or tokens in tracked repository files.
3. **Strict File Organization [SRC]:**  
   All Phase A and A.1 audit reports are placed in `docs/audits/phase-a/` and `docs/audits/phase-a1/`. The repository root contains zero loose reports.

---

## 2. Architectural Decision Table

| Recommendation | Security Benefit | Impact on Shared Demo Workflow | Implementation Complexity | Remaining Risk | Approval Required |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Rec 1: Evaluator Passphrase Gate (`DEMO_ACCESS_KEY`) on `/api/demo-login`** | Prevents unauthenticated bots from minting admin sessions via cURL; hides Supabase passwords from client JS. | Evaluator enters passcode once or uses `?demo_key=...`; 1-click persona switching preserved in session. | Low (Nitro route + `sessionStorage` in client). | Passcode can be shared among human evaluators. | **YES (Decision 1)** |
| **Rec 2: Role-Tiered Broker (1-Click Farmer/Tech, Gated Admin)** | Completely eliminates unauthorized admin session minting without requiring evaluators to enter keys for end-user testing. | 1-click for Farmer and Tech. Admin requires manual credentials or key. | Low (modify broker to reject admin persona without secret). | Farmer & Tech sessions remain mintable via cURL if broker is public. | **YES (Alternative to Rec 1)** |
| **Rec 3: Revoke Anonymous Upload Policy on Storage Buckets** | Closes anonymous file write access on `equipment-media` and `repair-media`. | Zero impact. App code does not upload files to storage buckets. | Low (single SQL migration drop policy). | Public read access remains on buckets for email logos. | **YES (Decision 2)** |
| **Rec 4: Retain Base64 In-Database Image Storage for User Photos** | Eliminates risk of public storage scraping; photos protected by PostgreSQL RLS. | Zero impact. Preserves existing camera, breakdown, and diagnostic workflows. | Zero (preserve current working code). | PostgreSQL row size is larger (~80KB/photo); acceptable for current scale. | **YES (Decision 3)** |
| **Rec 5: Reaffirm Zero RLS Isolation for Demo Accounts** | Preserves essential cross-account testing across real machinery and dispatch. | Essential. Guarantees demo accounts can test real life-cycle workflows. | Zero (no schema changes). | Demo accounts can modify test-shared records; mitigated by scoped reset. | **YES (Decision 4)** |

---

## 3. Phased Implementation Roadmap & Rollback Gates

```
[Phase 1: Broker Implementation] ---> [Phase 2: Client Rewiring] ---> [Phase 3: Storage Hardening] ---> [Phase 4: Remote Audit]
```

### Phase 1: Serverless Demo Broker (`POST /api/demo-login`)
* **Actions:**  
  1. Create `src/routes/api/demo-login.ts`.
  2. Implement `DEMO_MODE` gate and evaluator passphrase check (`x-demo-key`).
  3. Authenticate with Supabase using server-side `DEMO_AUTH_PASSWORD`.
  4. Return `{ session }` to the client.
* **Verification:** Unit test with mock requests testing authorized and unauthorized calls.
* **Rollback Plan:** Delete `src/routes/api/demo-login.ts`.

### Phase 2: Client Rewiring & Credential Removal
* **Actions:**  
  1. Update `src/routes/login.tsx` to call `/api/demo-login` instead of `fillAndSignIn()`.
  2. Update `src/routes/index.tsx` to call `/api/demo-login`.
  3. Remove plaintext passwords from source files.
* **Verification:** Run `npm test`, `npx tsc --noEmit`, and `npm run build`. Inspect build assets to confirm zero password occurrences.
* **Rollback Plan:** Revert `login.tsx` and `index.tsx` via `git checkout`.

### Phase 3: Storage Bucket Hardening
* **Actions:**  
  1. Draft forward migration dropping `"Anon users can upload demo media"` policy on storage buckets.
* **Verification:** Run SQL syntax validation and migration ordering checks.
* **Rollback Plan:** Do not apply migration until authorized.

---

## 4. Exact Decisions Requiring User Approval

Before any code changes, database operations, or builds are executed, please confirm approval on the following decisions:

* [ ] **Decision 1: Broker Authentication Strategy:**  
  Confirm whether to implement:
  * **Option A (Recommended):** Evaluator Passphrase Gate (`DEMO_ACCESS_KEY` via header / URL query param `?demo_key=...`, cached in `sessionStorage`).
  * **Option B:** Role-Tiered Broker (Unauthenticated 1-click for Farmer and Tech; Admin requires explicit credentials).
* [ ] **Decision 2: Storage Bucket Forward Migration:**  
  Authorize drafting a forward migration to drop `"Anon users can upload demo media"` on `equipment-media` and `repair-media`, while keeping public read for email logo assets.
* [ ] **Decision 3: Retain In-Database Base64 User Media:**  
  Confirm maintaining base64 photos in PostgreSQL tables (`repair_requests.photos`, `equipment.photo_url`) rather than moving to Supabase Storage.
* [ ] **Decision 4: Reaffirm Zero RLS Isolation:**  
  Confirm that no RLS policies will be altered to isolate demo accounts from real records.

*Standing by for your instructions. Zero code edits, migrations, API calls, or commits will occur until approved.*
