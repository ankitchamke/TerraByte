# External Integrations

**Analysis Date:** 2026-11-04

## APIs & External Services

**Visual Defect AI Diagnostics:**
- Google Gemini 3.5 Flash-Lite - Multimodal AI assessment of tractor and implement damage photos
  - SDK/Client: Direct REST invocation with JSON structured output (`src/lib/services/gemini-diagnostic.ts`)
  - Route Handler: `src/routes/api/assess-visual-defect.ts`
  - Auth: `GEMINI_API_KEY` (server-side only)
  - Features: Token claim-based execution, consent cancellation checks, bounded payload sanitization

**Speech-to-Text Transcription:**
- Groq Whisper Cloud API - Voice intake for breakdown symptom reporting
  - Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions` (`whisper-large-v3`)
  - Client: `src/lib/services/transcription-service.ts`
  - Auth: `GROQ_API_KEY` (server-side only)
  - Features: Sliding window rate limiting (10 req/min/user), 10 MB audio payload ceiling, allowed MIME whitelist

**Routing & Distance Calculations:**
- OSRM (Open Source Routing Machine) - Primary driving distance and duration engine for mobile repair dispatches
  - Endpoint: `https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}`
  - Client: `src/lib/services/routing.ts`
  - Route Handler: `src/routes/api/route-estimate.ts`
  - Auth: None (public open service)
- Google Maps Routes API - Server-side fallback driving distance and duration calculator
  - Endpoint: `https://routes.googleapis.com/directions/v2:computeRoutes`
  - Client: `src/lib/services/routing.ts`
  - Auth: `GOOGLE_MAPS_SERVER_KEY` (server-side only)
- Google Maps Universal Navigation - Client-side turn-by-turn navigation link
  - Format: `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`
  - Client: `src/lib/location.ts`, `src/components/directions-button.tsx`
  - Auth: None (browser intent)

**Model Context Protocol (MCP):**
- Lovable MCP Server - Exposes agricultural equipment diagnostic and dispatch tools to AI agents
  - Plugin: `@lovable.dev/mcp-js`
  - Route: `src/routes/mcp.ts`
  - Discovery: `src/routes/[.well-known]/oauth-protected-resource.ts`
  - Tools: `src/lib/mcp/tools/assess-breakdown.ts`, `src/lib/mcp/tools/list-symptoms.ts`, `src/lib/mcp/tools/match-technicians.ts`

## Data Storage

**Databases:**
- Managed Supabase PostgreSQL 17
  - Connection: `VITE_SUPABASE_URL` / `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
  - Server Admin Connection: `SUPABASE_SERVICE_ROLE_KEY` (used exclusively for secured background operations and test runners)
  - Client: `@supabase/supabase-js` (`src/integrations/supabase/client.ts`, `src/integrations/supabase/client.server.ts`)
  - Core Tables (18): `equipment`, `notifications`, `profiles`, `profile_contacts`, `profile_auth_secrets`, `quote_items`, `quotes`, `repair_messages`, `repair_notes`, `repair_dispatch_locations`, `repair_requests`, `repair_timeline`, `service_history`, `technician_profiles`, `service_centre_parts`, `service_centre_part_requests`, `service_centre_stock_audit`, `service_centre_part_sales`

**File Storage:**
- Supabase Storage
  - Buckets: `repair-photos`, `equipment-photos`, `avatars`
  - Configured in: `supabase/migrations/20260930000002_storage_setup.sql`, `supabase/migrations/20260930000004_storage_policies.sql`
  - Client upload helper: `src/lib/image.ts`

**In-Memory Store:**
- Client-side in-memory mock repository (`src/lib/tb-store.ts`) for offline preview mode, demo persona switching, and fallback UI state

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (GoTrue)
  - Implementation: JWT bearer token authentication and session cookies
  - Client Helpers: `src/lib/auth.ts`, `src/integrations/supabase/auth-middleware.ts`, `src/integrations/supabase/auth-attacher.ts`
  - Architectural Isolation: `profiles` table is completely decoupled from `auth.users.id`. Credentials and sensitive tokens are isolated in `public.profile_auth_secrets` with zero admin read access (`supabase/migrations/20261104100000_profile_security_separation.sql`)
  - Session Profile Resolution: Server RPC `public.get_session_profile()`

## Monitoring & Observability

**Error Tracking:**
- Custom Error Capture & SSR Fallback: `src/lib/error-capture.ts`, `src/lib/error-page.ts`, `src/server.ts`
- React Error Boundaries: `src/components/component-error-boundary.tsx` protecting interactive dashboard cards

**Health Checks & Diagnostics:**
- Health endpoint: `src/routes/api/health.ts`
- Logic: `src/lib/monitoring/health.ts`
- Auth: Bearer header verified via timing-safe comparison (`src/integrations/supabase/cron-auth.ts`) against `CRON_SECRET` or `TERRABYTE_CRON_SECRET`

**Logs:**
- Structured console logging in server functions and error handlers

## CI/CD & Deployment

**Hosting:**
- Vercel Serverless Platform (`vercel.json`, Nitro `vercel` preset in `vite.config.ts`)

**Connected VCS:**
- Git repository synced with Lovable platform (`phase-9` branch)

**Cron Jobs:**
- Vercel Cron configured in `vercel.json`:
  - Path: `/api/health`
  - Schedule: `0 5 * * 1,3,5` (Mon, Wed, Fri at 05:00 UTC)

## Environment Configuration

**Required env vars:**
- `VITE_SUPABASE_URL` / `SUPABASE_URL`: Supabase project URL (e.g. `https://hwdrypkvszwrcraujctw.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`: Supabase anon/publishable API key
- `SUPABASE_SERVICE_ROLE_KEY`: Service-role key for administrative RPC calls and seed tests
- `GOOGLE_MAPS_SERVER_KEY`: Server-side API key for Google Routes API calculations
- `GEMINI_API_KEY`: API key for Gemini 3.5 Flash-Lite multimodal analysis
- `GROQ_API_KEY`: API key for Groq Whisper transcription
- `CRON_SECRET` / `TERRABYTE_CRON_SECRET`: Bearer token for Vercel Cron health check probes

**Secrets location:**
- Local development: `.env` or `.env.local` (never committed, gitignored)
- Production: Vercel Environment Variables dashboard

## Webhooks & Callbacks

**Incoming:**
- Vercel Cron invocation against `/api/health`

**Realtime Streams (Outgoing WebSocket):**
- Supabase Realtime channel subscriptions over postgres changes (`postgres_changes` on `notifications`, `repair_requests`, `quotes`, `repair_timeline`, `service_centre_parts`, `service_centre_part_requests`) managed via `src/hooks/use-repair-realtime.ts`

---

*Integration audit: 2026-11-04*
