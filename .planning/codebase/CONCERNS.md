# Codebase Concerns, Risks & Technical Debt

**Analysis Date:** 2026-11-04

## 1. Tech Debt

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

---

## 2. Known Bugs & Operational Fragilities

**Public OSRM Rate Throttling:**
- Symptoms: Occasional HTTP 429 or timeout errors when calculating route estimates for field technician dispatches.
- Files: `src/lib/services/routing.ts`, `src/routes/api/route-estimate.ts`
- Trigger: Multiple concurrent dispatches or high traffic against the free public OSRM endpoint (`router.project-osrm.org`).
- Workaround: The system supports fallback to Google Routes API, but requires `GOOGLE_MAPS_SERVER_KEY` to be configured on the server.

**SSR Error Normalization in Nitro:**
- Files: `src/server.ts`, `src/lib/error-capture.ts`
- Why fragile: Nitro/h3 swallows uncaught server exceptions into 500 JSON bodies (`{"unhandled":true,"message":"HTTPError"}`), preventing standard try/catch wrappers from triggering.
- Current mitigation: `normalizeCatastrophicSsrResponse()` wrapper in `src/server.ts` catches and unwraps these payloads into styled error pages.

**Lovable VCS History Synchronization:**
- Files: `AGENTS.md`, `.git`
- Why fragile: Repository is bi-directionally connected to Lovable. Force pushing, amending commits, or rebasing destroys history synchronization on the Lovable platform.
- Safe modification: Always create additive conventional commits; never run `git push --force`.

---

## 3. Security Considerations & Privacy Boundaries

**Server Credential Leaks via Vite Prefixing:**
- Risk: Inadvertently adding `VITE_` prefix to sensitive credentials (`GOOGLE_MAPS_SERVER_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) would bundle secrets into client JavaScript.
- Files: `.env.example`, `src/routes/api/*.ts`
- Current mitigation: Environment templates explicitly document that server keys must not be prefixed with `VITE_`; tests enforce authorization boundaries.
- Recommendations: Add an automated lint rule or CI check scanning `.env*` and client bundles for prohibited server keys.

**Farmer Geolocation Privacy:**
- Risk: Exposing exact field GPS coordinates to unauthorized third parties or unassigned technicians.
- Files: `src/routes/farmer/repair/$id.tsx`, `src/routes/technician/job/$id.tsx`, `src/lib/services/routing.ts`
- Current mitigation: PostgreSQL RLS on `repair_dispatch_locations` limits reads to the farmer, assigned technician, and admin; UI partitions visibility into 3 explicit categories (`determineGpsVisibilityCategory`). Open queue cards render coarse location only.

**Farmer Privacy Quarantine on Spare Parts:**
- Risk: Exposing depot wholesale prices, supplier origins, or internal inventory telemetry to farmers.
- Current mitigation: PostgreSQL RLS denies farmers SELECT on `service_centre_parts` and `service_centre_part_requests`. Farmer UI relies solely on the high-level `WAITING_FOR_PARTS` status.

---

## 4. Performance Bottlenecks

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

---

## 5. Scaling Limits & Geographic Anchors

**Nagpur District Geographic Scope:**
- Current capacity: 14 Tahsils within Nagpur District hardcoded in `src/lib/location.ts` (Katol, Saoner, Umred, Hingna, etc.).
- Limit: Expanding service to other districts in Maharashtra (e.g. Wardha, Amravati, Chandrapur) requires refactoring.
- Scaling path: Transition from static TypeScript records to a dynamic `districts` and `tahsils` relational table in PostgreSQL.

---

## 6. Dependencies at Risk

**Nitro Beta Runtime:**
- Package: `nitro: "3.0.260603-beta"`
- Risk: Pre-release build required by TanStack Start; potential upstream API breaking changes between beta revisions.
- Impact: Build or SSR failure upon package upgrades.
- Migration plan: Pin exact version in `package.json` until TanStack Start stabilizes on a GA release of Nitro.

---

## 7. Deferred Features (Roadmap Inventory)

The following capabilities are deliberately out of scope for the current milestone and deferred to future phases:

1. **Integrated Payment Processing (UPI / Razorpay Escrow):**
   - Reason: Focus on mechanical coordination and verifiable service sign-off first; unintegrated payment disclaimer currently surfaced on sales ledgers.
2. **Offline PWA Mutation Queue (BackgroundSync ServiceWorker):**
   - Reason: Requires service worker architecture and client-side SQLite/IndexedDB queue; currently relies on live connectivity.
3. **IoT Telematics & CAN Bus Dongles (J1939 Protocol):**
   - Reason: Hardware dependency requiring physical OBD/CAN dongles for automatic DTC code ingestion.
4. **SMS / WhatsApp Webhook Bot (Twilio / Gupshup):**
   - Reason: Requires dedicated telephony gateways for non-smartphone fallback communication.
5. **Multi-Depot Inter-Store Inventory Transfers:**
   - Reason: Phase 9 focuses on single centralized Nagpur depot inventory.

---

## 8. Test Coverage Gaps

**Browser DOM & End-to-End Component Tests:**
- What's not tested: Real browser DOM interactions, form validation rendering, and modal focus traps.
- Files: `src/components/*.tsx`, `src/routes/**/*.tsx`
- Risk: Visual regressions or client-side hydration mismatches could escape unnoticed.
- Current coverage: 144 automated Node.js tests covering database contracts, migrations, RLS simulation, and pure business logic.

---

*Concerns audit: 2026-11-04*
