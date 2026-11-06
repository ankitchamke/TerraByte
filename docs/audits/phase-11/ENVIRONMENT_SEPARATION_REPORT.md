# TerraByte — Staging & Production Environment Separation Review & Audit Report

**Audit Date:** 2026-11-06  
**Auditor:** Antigravity Autonomous Agent  
**Branch:** `phase-11`  
**Repository:** `d:\Projects\TerraByte`  
**Scope:** Final Environment Separation Review, Production Development Safety, Canonical Supabase Configuration, Client Bundle Secret Audit, and Vercel Environment Matrix.

---

## 1. Executive Summary

This security and architecture audit establishes strict, verified environment separation between the **TerraByte Staging Environment** (`ubqgvhcfmrvnmrbllcom`) and the **TerraByte Production Environment** (`hwdrypkvszwrcraujctw`).

Key achievements of this review:
1. **Production Safety Invariant**: The hazardous `"dev:production"` script has been permanently eliminated from `package.json`. All local development commands (`npm run dev` and `npm run dev:staging`) default safely to the isolated staging project.
2. **Canonical Authoritative Configuration**: All hardcoded `CANONICAL_SUPABASE_URL` and `CANONICAL_SUPABASE_KEY` fallback constants have been eradicated from `src/integrations/supabase/client.ts`, `src/integrations/supabase/client.server.ts`, and `src/routes/api/assess-visual-defect.ts`. Environment variables are now the sole authoritative source of truth.
3. **Fail-Closed Cross-Contamination Guards**: Bi-directional guards enforce that staging modes can never communicate with the production database, and production builds can never communicate with the staging database. Any missing configuration throws immediately at initialization rather than silently falling back.
4. **Zero-Secret Client Bundles**: Automated bundle analysis (`scratch/phase-11/audit_bundle_secrets.mjs`) verified that client bundles in both staging and production distributions contain **0 service-role keys**, **0 database connection strings/passwords**, and **0 server-side API keys**.
5. **Full Test & Live Acceptance Pass**: All 160 unit and integration tests passed (`npm test`), strict TypeScript typecheck passed with 0 errors (`npx tsc --noEmit`), and the live Phase 11 end-to-end diagnostic workflow on staging passed all 8 verification steps.

---

## 2. Production Development Safety Review (`dev:production`)

### 2.1 Hazard Analysis
The `package.json` file previously contained:
```json
"dev:production": "vite dev --mode production"
```
Because the TerraByte application actively performs state mutations (farmer breakdown ticket submissions, technician job acceptances, parts requisitions, quote approvals, and chat messaging), running local development against the live production database (`hwdrypkvszwrcraujctw`) presents severe operational risks:
- Developers or agents could accidentally corrupt production records, submit test breakdown tickets to real farmers, or deplete real inventory ledgers.
- The production database has not yet received Phase 11 database migrations (`grant_repair_visual_consent`, `repair_defect_annotations`, etc.), so running against production in development mode causes unhandled schema cache errors.
- Read-only simulation at the application level adds fragile complexity that can be bypassed by direct RPCs or service mutations.

### 2.2 Corrective Action
The `"dev:production"` script was **completely removed** from `package.json`. 

The verified script roster is now:
| Script | Command | Target Environment | Purpose |
| :--- | :--- | :--- | :--- |
| `dev` | `vite dev --mode staging` | **Staging (`ubqgvhcfmrvnmrbllcom`)** | Standard safe local development |
| `dev:staging` | `vite dev --mode staging` | **Staging (`ubqgvhcfmrvnmrbllcom`)** | Explicit staging development |
| `build` | `vite build --mode production` | **Production (`hwdrypkvszwrcraujctw`)** | Standard production release build |
| `build:production` | `vite build --mode production` | **Production (`hwdrypkvszwrcraujctw`)** | Explicit production build |
| `build:staging` | `vite build --mode staging` | **Staging (`ubqgvhcfmrvnmrbllcom`)** | Staging preview deployment build |
| `build:dev` | `vite build --mode development` | **Staging (`ubqgvhcfmrvnmrbllcom`)** | Development test build |

Local developers and agents can never accidentally spin up a local development server pointed at production.

---

## 3. Canonical Supabase Configuration Architecture

### 3.1 Elimination of Hardcoded Fallbacks
Previously, `client.ts` and `assess-visual-defect.ts` contained hardcoded production references:
```typescript
// REMOVED - VIOLATED ENVIRONMENT ISOLATION
const CANONICAL_SUPABASE_URL = "https://hwdrypkvszwrcraujctw.supabase.co";
const CANONICAL_SUPABASE_KEY = "sb_publishable_N5Najdw3CfFpFv3gNy0sdA_HNGtdRrq";
```
These fallbacks meant that if environment variables were misconfigured or unset, the application would silently connect to the production database even when operating under non-production intentions.

### 3.2 Refactored Client Architecture (`src/integrations/supabase/client.ts`)
The client initialization now strictly requires environment variables and enforces active fail-closed validation:

```typescript
function createSupabaseClient() {
  const processEnv = typeof process !== "undefined" && process?.env ? process.env : undefined;
  const mode = import.meta.env.MODE;

  const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] || processEnv?.['SUPABASE_URL'];
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ||
    import.meta.env['VITE_SUPABASE_ANON_KEY'] ||
    processEnv?.['SUPABASE_PUBLISHABLE_KEY'] ||
    processEnv?.['SUPABASE_ANON_KEY'];

  // Missing configuration fails closed
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL / VITE_SUPABASE_URL'] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY'] : []),
    ];
    const message = `Missing required Supabase environment variable(s): ${missing.join(', ')}. Please verify .env, .env.staging, or .env.production.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  // Cross-environment contamination guard: Staging cannot target production
  if (mode === "staging" && SUPABASE_URL.includes("hwdrypkvszwrcraujctw")) {
    throw new Error(
      "[Supabase] Configuration error: Staging mode cannot connect to production Supabase project (hwdrypkvszwrcraujctw). Check .env.staging.",
    );
  }

  // Cross-environment contamination guard: Production cannot target staging
  if (mode === "production" && SUPABASE_URL.includes("ubqgvhcfmrvnmrbllcom")) {
    throw new Error(
      "[Supabase] Configuration error: Production mode cannot connect to staging Supabase project (ubqgvhcfmrvnmrbllcom). Check .env.production.",
    );
  }

  // Guard against decommissioned starter project
  if (SUPABASE_URL.includes("fmnzoovazqpyaebqmqyo")) {
    throw new Error(
      "[Supabase] Configuration error: Target URL points to decommissioned project (fmnzoovazqpyaebqmqyo). Please update environment configuration.",
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { ... });
}
```

### 3.3 Server Client Architecture (`src/integrations/supabase/client.server.ts`)
The server-side admin client similarly requires `SUPABASE_SERVICE_ROLE_KEY` exclusively from `process.env` and applies identical cross-contamination and decommissioned project guards:
- Staging server instances cannot connect to `hwdrypkvszwrcraujctw`.
- Production server instances cannot connect to `ubqgvhcfmrvnmrbllcom`.
- Missing variables throw immediately with fail-closed semantics.

### 3.4 API Route Architecture (`src/routes/api/assess-visual-defect.ts`)
`getSupabaseConfig()` in the Phase 11 Visual Defect API endpoint was updated to completely eliminate `CANONICAL_SUPABASE_URL` and `CANONICAL_SUPABASE_KEY`. If `SUPABASE_URL` or key is missing from `process.env` / `import.meta.env`, it fails closed and rejects requests with a clear configuration error.

---

## 4. Build Isolation & Client Bundle Secret Audit

### 4.1 Audit Methodology
The automated script `scratch/phase-11/audit_bundle_secrets.mjs` was executed against the built output directory (`.vercel/output/static/assets/`) following both staging and production builds. The script tests for:
1. `SUPABASE_SERVICE_ROLE_KEY` (secret patterns `sb_secret_`, standard Supabase JWT service-role tokens).
2. Database passwords and connection strings (`postgresql://`, `postgres:***`).
3. External API secrets (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CRON_SECRET`).
4. Active target project reference verification.

### 4.2 Staging Build Results (`npm run build:staging`)
- **Compilation Status**: `PASS` (Built in 2.28s)
- **Active Target URL**: `https://ubqgvhcfmrvnmrbllcom.supabase.co`
- **Active Publishable Key**: `sb_publishable_89gL_...`
- **Secret Audit**: **`CLEAN — 100% verified zero secrets in client assets`**
- **Isolation Check**: The production project ref `hwdrypkvszwrcraujctw` is only present in string literals within the defensive error guard preventing staging from connecting to production.

### 4.3 Production Build Results (`npm run build:production`)
- **Compilation Status**: `PASS` (Built in 2.69s)
- **Active Target URL**: `https://hwdrypkvszwrcraujctw.supabase.co`
- **Active Publishable Key**: `sb_publishable_N5Najdw3CfFpFv3gNy0sdA_HNGtdRrq`
- **Secret Audit**: **`CLEAN — 100% verified zero secrets in client assets`**
- **Isolation Check**: The staging project ref `ubqgvhcfmrvnmrbllcom` is only present in string literals within the defensive error guard preventing production from connecting to staging.

---

## 5. Vercel Deployment Configuration Matrix

To deploy TerraByte reliably on Vercel without risking cross-contamination or secret leaks, configure environment variables across **Production** and **Preview** environments as documented below.

### 5.1 Environment Variable Specification Table

| Variable Name | Environment Scope | Secret / Public | Required Value / Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | **Production** | Public (Browser) | `https://hwdrypkvszwrcraujctw.supabase.co` | Production Supabase endpoint for frontend client |
| `VITE_SUPABASE_URL` | **Preview** | Public (Browser) | `https://ubqgvhcfmrvnmrbllcom.supabase.co` | Staging Supabase endpoint for preview deployments |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **Production** | Public (Browser) | `sb_publishable_N5Najdw3CfFpFv3gNy0sdA_HNGtdRrq` | Production Supabase anon/publishable key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **Preview** | Public (Browser) | Staging publishable key (`.env.staging`) | Staging Supabase anon/publishable key |
| `SUPABASE_URL` | **Production** | Server-Only | `https://hwdrypkvszwrcraujctw.supabase.co` | Server route handlers and Nitro SSR |
| `SUPABASE_URL` | **Preview** | Server-Only | `https://ubqgvhcfmrvnmrbllcom.supabase.co` | Preview server route handlers and Nitro SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production** | **Strict Secret** | Production `service_role` key | Server-side admin operations (RLS bypass) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Preview** | **Strict Secret** | Staging `service_role` key (`.env.staging`) | Staging server-side admin operations |
| `GEMINI_API_KEY` | **Production & Preview** | **Strict Secret** | Active Google AI Studio / Gemini API key | Phase 11 Visual Defect Diagnostics server execution |
| `GROQ_API_KEY` | **Production & Preview** | **Strict Secret** | Active Groq API key | Audio transcription service (Whisper API) |
| `CRON_SECRET` | **Production & Preview** | **Strict Secret** | High-entropy random secret | Protection for scheduled background maintenance routes |

### 5.2 Key Vercel Configuration Rules
1. **Never set `SUPABASE_SERVICE_ROLE_KEY` with a `VITE_` prefix**: Vite bundles any environment variable beginning with `VITE_` directly into client JavaScript. Keeping it as `SUPABASE_SERVICE_ROLE_KEY` guarantees it is only accessible in Nitro serverless functions (`__server.func`).
2. **Preview Environment Isolation**: In the Vercel Project Settings > Environment Variables dashboard:
   - Check **Production** ONLY for production credentials (`hwdrypkvszwrcraujctw`).
   - Check **Preview** ONLY for staging credentials (`ubqgvhcfmrvnmrbllcom`).
   - Check **Development** ONLY for staging credentials (`ubqgvhcfmrvnmrbllcom`).
3. **Build Command Selection via Dispatcher**:
   - Vercel executes `npm run build` by default.
   - The build dispatcher (`scripts/vercel-build.mjs`) automatically inspects `VERCEL_ENV` and routes to `build:production` or `build:staging`.

### 5.3 Automated Vercel Build Mode Dispatcher (`scripts/vercel-build.mjs`)

Because Vercel executes a single configured build command across both production and preview pipelines, relying on a hardcoded script or static config causes preview builds to run in production mode. To prevent this, `package.json` wires `"build"` to `scripts/vercel-build.mjs`.

The dispatcher evaluates the platform-injected `VERCEL_ENV` indicator:
```javascript
const vercelEnv = process.env.VERCEL_ENV;
const isPreview = vercelEnv === "preview";
const targetScript = isPreview ? "build:staging" : "build:production";
const targetMode = isPreview ? "staging" : "production";
```
- **Vercel Preview (`VERCEL_ENV === "preview"`)**: Dispatches to `npm run build:staging` (`vite build --mode staging`).
- **Vercel Production (`VERCEL_ENV === "production"`)**: Dispatches to `npm run build:production` (`vite build --mode production`).
- **Local / Default**: Dispatches to `npm run build:production`.

### 5.4 Simulated Build Environment Verification

Both deployment paths were simulated locally to verify end-to-end correctness:

1. **Simulated Preview (`VERCEL_ENV=preview npm run build`)**:
   - Dispatcher logged: `[Vercel Build Dispatcher] VERCEL_ENV='preview' -> Dispatching to 'build:staging' (Vite mode: staging)`.
   - Build Status: `PASS` (Built client in 3.11s, nitro SSR in 1.36s).
   - Compiled Client Asset Supabase Endpoint: `https://ubqgvhcfmrvnmrbllcom.supabase.co`.
   - Secret Exposure Audit: `CLEAN — 100% verified zero secrets in client assets`.
2. **Simulated Production (`VERCEL_ENV=production npm run build`)**:
   - Dispatcher logged: `[Vercel Build Dispatcher] VERCEL_ENV='production' -> Dispatching to 'build:production' (Vite mode: production)`.
   - Build Status: `PASS` (Built client in 3.06s, nitro SSR in 1.36s).
   - Compiled Client Asset Supabase Endpoint: `https://hwdrypkvszwrcraujctw.supabase.co`.
   - Secret Exposure Audit: `CLEAN — 100% verified zero secrets in client assets`.

---

## 6. Verification Evidence Summary

| Check ID | Verification Task | Target | Command | Result |
| :--- | :--- | :--- | :--- | :--- |
| **VERIF-01** | TypeScript Typecheck | Codebase | `npx tsc --noEmit` | **`PASS`** (0 errors) |
| **VERIF-02** | Automated Unit & Integration Tests | Test Suite | `npm test` | **`PASS`** (160/160 passed) |
| **VERIF-03** | Staging Distribution Build | Staging | `npm run build:staging` | **`PASS`** (Built in 2.28s) |
| **VERIF-04** | Production Distribution Build | Production | `npm run build:production` | **`PASS`** (Built in 2.69s) |
| **VERIF-05** | Staging Bundle Secret Audit | Bundle | `node scratch/phase-11/audit_bundle_secrets.mjs` | **`PASS`** (0 secrets found) |
| **VERIF-06** | Production Bundle Secret Audit | Bundle | `node scratch/phase-11/audit_bundle_secrets.mjs` | **`PASS`** (0 secrets found) |
| **VERIF-07** | Live Staging Consent & AI Acceptance | Staging DB & API | `npx tsx scratch/phase-11/verify_app_consent_flow.mjs` | **`PASS`** (8/8 steps passed) |
| **VERIF-08** | Vercel Preview Build Simulation | Preview Mode | `VERCEL_ENV=preview npm run build` | **`PASS`** (`ubqgvhcfmrvnmrbllcom`) |
| **VERIF-09** | Vercel Production Build Simulation | Production Mode | `VERCEL_ENV=production npm run build` | **`PASS`** (`hwdrypkvszwrcraujctw`) |

---

## 7. Strict Operational Boundaries & Conformance

Throughout this review and configuration hardening:
- **Production Supabase (`hwdrypkvszwrcraujctw`)**: Kept strictly read-only and untouched. **Zero** SQL queries, DDL, DML, or migrations were run against production.
- **Staging Supabase (`ubqgvhcfmrvnmrbllcom`)**: Operational state preserved with 18 tables, 49 RLS policies, authentic tractor photographic assets, and synthetic test personas intact.
- **Git State**: No `git commit` or `git push` commands were executed, maintaining complete compatibility with the Lovable development workflow.
- **File System Hygiene**: All audit records reside in `docs/audits/phase-11/` and temporary diagnostics reside in `scratch/phase-11/`, respecting the strict repository layout invariant.
