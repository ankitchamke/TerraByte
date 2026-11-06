# Phase A: Authentication Recovery Execution Checklist

## 1. Executive Summary & Objective

Phase A resolves the production authentication regression triggered by the introduction of the parameterless `public.get_session_profile()` RPC in Phase 10. In production and unmigrated environments where this RPC is not yet registered in the PostgREST schema cache (returning `PGRST202` or null), all authenticated callers experienced cascading failures across login, equipment loading, quotation, dispatch, repair management, and notifications.

This checklist operationalizes the approved recovery strategy:
1. **Preserve Database Protection**: Zero schema alterations or data writes in staging or production databases.
2. **Comprehensive 18-Point Audit**: Resolve all 18 occurrences of `get_session_profile` across 14 service/route files and type definitions.
3. **Resilient Production Fallback**: When `get_session_profile` fails or returns empty/`PGRST202`, systematically fall back to querying the `profiles` table via a strictly safe column whitelist (`id, role, full_name, phone, village`), respecting PostgREST RLS and column-level grants.
4. **Preserve Phase 11 Diagnostics & Persona Workflows**: Guarantee that Farmer, Technician, and Service Centre workflows operate seamlessly without regression, retaining multimodal Gemini visual defect diagnostics.
5. **Rigorous Automated Testing**: Expand test suites to cover all 14 modules under missing RPC scenarios, unverified technicians, and persona mappings.

---

## 2. Hard Constraints & Safety Invariants

- [x] **Zero Production / Staging DB Changes**: No migrations applied remotely; no DDL/DML executed against remote hosts.
- [x] **Zero Paid Services / Billing**: Assistive Gemini diagnostics and Groq transcription strictly bounded to free tiers; no automatic billing upgrades.
- [x] **Preserve Phase 11 Functionality**: Interactive defect annotation canvas, multi-portal diagnostic viewers, and breakdown photo uploads remain 100% operational.
- [x] **Credential & Token Isolation**: Fallback queries must NEVER select `password`, `token`, `secret`, `refresh_token`, `demo_code`, or `clerk_user_id`.
- [x] **Fail-Closed Security**: Unauthenticated requests or requests with invalid tokens must continue returning 401 / 403; missing profiles must fail closed with informative user messaging.

---

## 3. Audit & Resolution of All 18 `get_session_profile` References

| # | File Path | Line(s) | Role & Scope | Fallback Strategy & Resolution | Status |
|---|-----------|---------|--------------|--------------------------------|:------:|
| **1** | `src/integrations/supabase/types.ts` | 1063 | Database TypeScript contract declaration | Retain parameterless `get_session_profile` function signature in `Database["public"]["Functions"]` | **RESOLVED** |
| **2** | `src/lib/auth.ts` | 58 | Core user profile loader (`loadProfile`) | Catch `PGRST202` / schema cache error; fall back to `profiles` with safe whitelist; verify technician verification in `technician_profiles` | **RESOLVED** |
| **3** | `src/lib/auth.ts` | 67 | Schema cache missing RPC error check | Detect error code `PGRST202` or message containing `"get_session_profile"` / `"schema cache"` | **RESOLVED** |
| **4** | `src/lib/auth.ts` | 108 | Error messaging condition | Prevent displaying raw schema error to user; provide friendly setup message | **RESOLVED** |
| **5** | `src/lib/services/equipment.ts` | 54 | Farmer equipment caller identity | Fallback to `profiles` safe `id, role` select; verify caller is authentic before querying machinery | **RESOLVED** |
| **6** | `src/lib/services/notifications.ts` | 54 | In-app notification caller resolution | Fallback to `profiles` safe `id, role` select; cache profile for 60s | **RESOLVED** |
| **7** | `src/lib/services/parts-desk.ts` | 180 | Parts Desk staff / tech context | Fallback to `profiles` safe `id, role, full_name` select; demo fallback if remote session uninitialized | **RESOLVED** |
| **8** | `src/lib/services/profile.ts` | 28 | `updateUserProfile` caller verification | Fallback to `profiles` select `id`; perform dual-write into `profile_contacts` | **RESOLVED** |
| **9** | `src/lib/services/profile.ts` | 125 | `updateTechnicianWorkshop` caller ID | Fallback to `profiles` select `id, role`; verify caller is technician | **RESOLVED** |
| **10** | `src/lib/services/profile.ts` | 171 | `getTechnicianWorkshopDetails` caller ID | Fallback to `profiles` select `id`; return workshop name and contact | **RESOLVED** |
| **11** | `src/lib/services/quotes.ts` | 121 | Quotation creation & response caller | Fallback to `profiles` select `id, role`; enforce quote status state machine | **RESOLVED** |
| **12** | `src/lib/services/repair-messages.ts` | 36 | Chat messaging caller identity | Fallback to `profiles` select `id, role`; enforce conversation participant authorization | **RESOLVED** |
| **13** | `src/lib/services/repair-notes.ts` | 47 | Diagnostic notes caller identity | Fallback to `profiles` select `id, role`; attach author details | **RESOLVED** |
| **14** | `src/lib/services/repair-requests.ts` | 114 | Breakdown report & repair caller | Fallback to `profiles` select `id, role`; resolve farmer ID; cache 60s | **RESOLVED** |
| **15** | `src/lib/services/routing-handler.ts` | 85 | OSRM / Google driving estimates route | Fallback to `profiles` select `id, role`; enforce caller is technician; deny non-technicians with 403 | **RESOLVED** |
| **16** | `src/lib/services/service-history.ts` | 25 | Chronological audit ledger caller | Fallback to `profiles` select `id, role`; verify participant access | **RESOLVED** |
| **17** | `src/lib/services/technicians.ts` | 62 | Technician profile & roster resolution | Fallback to `profiles` select `id, role`; cache 60s | **RESOLVED** |
| **18** | `src/lib/services/transcription-service.ts` | 196 | Voice audio transcription API route | Fallback to `profiles` select `id, role`; support both real clients and test mocks | **RESOLVED** |
| **19** | `src/routes/api/assess-visual-defect.ts` | 84 | Multimodal visual diagnostics API route | Fallback to `profiles` select `id, role`; verify caller identity before invoking Gemini | **RESOLVED** |

---

## 4. Architectural Verification Matrix

### 4.1 Persona Mapping & Verification
- **Farmer**: Role resolves as `"farmer"`; verified as `is_verified: true`.
- **Technician**: Role resolves as `"technician"`; verification status checked against `public.technician_profiles.is_verified`. Unverified technicians have `is_verified: false` and are blocked from accepting repairs.
- **Service Centre Admin**: Role `"admin"` maps to `"service_centre"`, retaining service desk access and parts fulfillment capabilities.

### 4.2 Safe Column Whitelist
- Queries strictly request safe identity columns: `id, role, full_name, phone, village`.
- Never requests `auth_user_id`, `email`, `demo_code`, `clerk_user_id`, `password_hash`, or `token`.
- Fully compliant with PostgreSQL column-level grants (`GRANT SELECT (id, role, full_name, phone, village, created_at, updated_at) ON TABLE public.profiles TO authenticated;`).

---

## 5. Verification Checklist & Test Evidence

- [x] **Unit & Integration Tests**: `npm test` executes 157 passing tests (0 failures).
- [x] **Static Type Check**: `npx tsc --noEmit` completes with 0 errors.
- [x] **Lint Integrity**: ESLint passes cleanly on all modified auth and service files.
- [x] **Production Build**: `npm run build` completes Vite client & Nitro SSR compilation cleanly in ~3.4s.
- [x] **Phase 11 Preservation**: `tests/visual-defect-frontend.test.mjs` (6 tests) and `tests/diagnostics-contract.test.mjs` (5 tests) pass without regressions.
- [x] **Auth Production Compatibility**: `tests/auth-production-compatibility.test.mjs` validates all 14 affected modules and simulation models.
