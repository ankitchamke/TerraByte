# Codebase Concerns

**Analysis Date:** 2026-11-04

## Tech Debt

**Monolithic In-Memory Fallback Store (`tb-store.ts`):**
- Issue: `src/lib/tb-store.ts` is over 1,700 lines (74 KB). It contains mock seed data, in-memory state mutation functions, and catalog fixtures duplicating live database schemas.
- Files: `src/lib/tb-store.ts`
- Impact: High cognitive overhead and risk of divergence between live PostgreSQL behaviors and offline mock implementations.
- Fix approach: Modularize `tb-store.ts` into discrete sub-stores (`mock-parts.ts`, `mock-repairs.ts`, `mock-profiles.ts`) or phase out client-side mock logic in favor of local Supabase development.

**Application-Level Dual Write for Profile Contacts:**
- Issue: Updating user profile details in `src/lib/services/profile.ts` performs separate writes to `public.profiles` and `public.profile_contacts` in client code.
- Files: `src/lib/services/profile.ts`
- Impact: If the second write fails, profile metadata and contact information can fall out of sync.
- Fix approach: Encapsulate profile and contact updates in an atomic PostgreSQL stored procedure (e.g. `update_user_profile_and_contacts()`).

**Accumulated SQL Migration Footprint:**
- Issue: `supabase/migrations/` has accumulated 38 migration files, some of which patch or override previous demo RPCs (`reset_demo_data`).
- Files: `supabase/migrations/*.sql`
- Impact: Slower fresh database migrations and complexity when auditing schema evolution.
- Fix approach: Consolidate historical baseline migrations prior to production launch while preserving migration integrity.

## Known Bugs

**Public OSRM Rate Throttling:**
- Symptoms: Occasional HTTP 429 or timeout errors when calculating route estimates for field technician dispatches.
- Files: `src/lib/services/routing.ts`, `src/routes/api/route-estimate.ts`
- Trigger: Multiple concurrent dispatches or high traffic against the free public OSRM endpoint (`router.project-osrm.org`).
- Workaround: The system supports fallback to Google Routes API, but requires `GOOGLE_MAPS_SERVER_KEY` to be configured.

## Security Considerations

**Server Credential Leaks via Vite Prefixing:**
- Risk: Inadvertently adding `VITE_` prefix to sensitive credentials (`GOOGLE_MAPS_SERVER_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CRON_SECRET`) would bundle secrets into client JavaScript.
- Files: `.env.example`, `src/routes/api/*.ts`
- Current mitigation: Environment templates explicitly document that server keys must not be prefixed with `VITE_`; tests enforce authorization boundaries.
- Recommendations: Add an automated lint rule or CI check scanning `.env*` and client bundles for prohibited server keys.

**Farmer Geolocation Privacy:**
- Risk: Exposing exact field GPS coordinates to unauthorized third parties or unassigned technicians.
- Files: `src/routes/farmer/repair/$id.tsx`, `src/routes/technician/job/$id.tsx`, `src/lib/services/routing.ts`
- Current mitigation: PostgreSQL RLS on `repair_dispatch_locations` limits reads to the farmer, assigned technician, and admin; UI partitions visibility into 3 explicit categories (`determineGpsVisibilityCategory`).
- Recommendations: Maintain strict non-admin exclusion from reading dispatch location tables for unassigned jobs.

## Performance Bottlenecks

**Supabase Realtime Subscription Frequency:**
- Problem: Mounting real-time WebSocket channels on multiple active ticket and list views can saturate client network and cause re-render storms.
- Files: `src/hooks/use-repair-realtime.ts`
- Cause: Unbounded `postgres_changes` events firing on rapid status or message updates.
- Improvement path: Coalescing window (currently 300ms debounce) is implemented; maintain debounced invalidation and avoid payload broadcasting.

**Large Voice Recording Payloads:**
- Problem: Raw audio capture in mobile browsers (e.g. uncompressed WAV) can exceed the Groq 10 MB payload limit or fail on 2G/3G rural networks.
- Files: `src/lib/services/transcription-service.ts`
- Cause: Variable media recorder MIME support across Android browsers.
- Improvement path: Enforce client-side Opus compression and max recording duration limit (e.g. 60 seconds) before initiating upload.

## Fragile Areas

**Lovable VCS History Synchronization:**
- Files: `AGENTS.md`, `.git`
- Why fragile: Repository is bi-directionally connected to Lovable. Force pushing, amending commits, or rebasing destroys history synchronization on the Lovable platform.
- Safe modification: Always create additive conventional commits; never run `git push --force`.

**SSR Error Normalization in Nitro:**
- Files: `src/server.ts`, `src/lib/error-capture.ts`
- Why fragile: Nitro/h3 swallows uncaught server exceptions into 500 JSON bodies (`{"unhandled":true,"message":"HTTPError"}`), preventing standard try/catch wrappers from triggering.
- Safe modification: Preserve `normalizeCatastrophicSsrResponse()` wrapper in `src/server.ts`.

## Scaling Limits

**Nagpur District Geographic Scope:**
- Current capacity: 14 Tahsils within Nagpur District hardcoded in `src/lib/location.ts`.
- Limit: Expanding service to other districts in Maharashtra (e.g. Wardha, Amravati, Chandrapur) requires refactoring.
- Scaling path: Transition from static TypeScript records to a dynamic `districts` and `tahsils` relational table in PostgreSQL.

## Dependencies at Risk

**Nitro Beta Runtime:**
- Package: `nitro: "3.0.260603-beta"`
- Risk: Pre-release build required by TanStack Start; potential upstream API breaking changes between beta revisions.
- Impact: Build or SSR failure upon package upgrades.
- Migration plan: Pin exact version in `package.json` until TanStack Start stabilizes on a GA release of Nitro.

## Missing Critical Features

**Offline Mutation Queue for Remote Field Work:**
- Problem: Technicians working in remote agricultural fields often experience complete cellular connectivity loss.
- Blocks: Technicians cannot submit parts holds, status updates, or completion notes while offline without failing requests.
- Recommendation: Introduce service worker offline action queuing with background sync when connectivity is restored.

## Test Coverage Gaps

**Browser DOM & End-to-End Component Tests:**
- What's not tested: Real browser DOM interactions, form validation rendering, and dialog interactions.
- Files: `src/components/*.tsx`, `src/routes/**/*.tsx`
- Risk: Visual regressions or client-side hydration mismatches could escape unnoticed.
- Priority: Medium (Currently covered by 144 Node.js static contract and logic tests in `tests/*.test.mjs`).

---

*Concerns audit: 2026-11-04*
