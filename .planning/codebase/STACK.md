# Technology Stack

**Analysis Date:** 2026-11-04

## Languages

**Primary:**
- TypeScript 5.8.3 - Full application codebase across UI components, routing, services, and server handlers (`src/**/*.ts`, `src/**/*.tsx`, `tsconfig.json`)
- JavaScript (Node.js ESM) - Test suites, configuration files, build tooling (`tests/*.test.mjs`, `eslint.config.js`)

**Secondary:**
- PostgreSQL SQL (v17) - Relational schema, Row Level Security (RLS) policies, triggers, and RPC functions (`supabase/migrations/*.sql`)
- CSS - Styling with Tailwind CSS v4 and Google Fonts (`src/styles.css`)

## Runtime

**Environment:**
- Node.js 22+ (test execution and server runtime)
- Modern Evergreen Browsers (Vite client bundle target ES2022)

**Package Manager:**
- Bun / npm
- Lockfile: `bun.lock` (primary) and `package-lock.json` (supported) present

## Frameworks

**Core:**
- TanStack Start (v1.168.60) - Full-stack React SSR and server function framework (`src/start.ts`, `src/server.ts`)
- TanStack Router (v1.170.41) - Type-safe, file-system based routing (`src/router.tsx`, `src/routeTree.gen.ts`, `src/routes/**`)
- TanStack Query (v5.101.1) - Client-side asynchronous server state management, caching, and invalidation (`src/router.tsx`, `src/routes/__root.tsx`)
- React 19 (v19.2.0) - Declarative UI library with concurrent rendering features (`src/routes/**`, `src/components/**`)

**UI & Design System:**
- Tailwind CSS v4 (v4.2.1) - Utility-first CSS framework via `@tailwindcss/vite`
- Radix UI Primitives - Accessible unstyled primitives (`@radix-ui/react-*` in `src/components/ui/`)
- Lucide React (v0.575.0) - Application iconography
- Sonner (v2.0.7) - Toast notification system (`src/components/ui/sonner.tsx`)
- Vaul (v1.1.2) & Embla Carousel (v8.6.0) - Mobile bottom drawers and media carousels
- Recharts (v2.15.4) - Analytical charts in administrative dashboards

**Testing:**
- Node.js native test runner (`node:test`, `node:assert/strict`) - Test runner and assertion library (`npm test` executes `node --test tests/*.test.mjs`)

**Build/Dev:**
- Vite (v8.1.5) - Next-generation frontend build tool and development server (`vite.config.ts`)
- Nitro (v3.0.260603-beta) - Server engine configured with `"vercel"` preset (`vite.config.ts`)
- `@lovable.dev/vite-tanstack-config` (v2.24.0) - Base TanStack Start + Vite plugin integration
- `@lovable.dev/mcp-js` (v3.0.4) - Model Context Protocol plugin for Vite (`src/routes/mcp.ts`)
- `vite-tsconfig-paths` (v6.0.2) - Automatic TypeScript path mapping resolution (`@/*`)

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` (v2.117.2) - Official Supabase client for database operations, authentication, Realtime subscriptions, and storage buckets (`src/integrations/supabase/client.ts`, `src/integrations/supabase/client.server.ts`)
- `zod` (v3.25.76) - Schema declaration and validation library used for diagnostic boundaries and contract verification (`src/lib/types/visual-diagnostics.ts`)
- `react-hook-form` (v7.71.2) & `@hookform/resolvers` (v5.2.2) - High-performance form state management paired with Zod resolvers

**Infrastructure:**
- `clsx` (v2.1.1) & `tailwind-merge` (v3.5.0) - Class merging utility function (`src/lib/utils.ts` `cn()`)
- `class-variance-authority` (v0.7.1) - Variant-driven component styling (`src/components/ui/button.tsx`, etc.)
- `date-fns` (v4.1.0) - Robust date math and display utilities (`src/lib/date-utils.ts`)
- `cmdk` (v1.1.1) & `input-otp` (v1.4.2) - Command palette and verification code inputs

## Configuration

**Environment:**
- Configured via `.env` / `.env.local` based on template `.env.example`
- Critical runtime variables:
  - `VITE_SUPABASE_URL` / `SUPABASE_URL` - Supabase project endpoint
  - `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` - Supabase anonymous public key
  - `GOOGLE_MAPS_SERVER_KEY` - Server-side Google Maps Routes API credential
  - `GEMINI_API_KEY` - Google Gemini API key for visual defect diagnostics
  - `GROQ_API_KEY` - Groq API key for Whisper audio transcription
  - `CRON_SECRET` / `TERRABYTE_CRON_SECRET` - Timing-safe bearer secret for scheduled health probes

**Build & Tooling:**
- `tsconfig.json`: TypeScript configuration with `target: "ES2022"`, `moduleResolution: "Bundler"`, path alias `@/* -> ./src/*`, strict checking flags
- `vite.config.ts`: TanStack Start entry redirection to `src/server.ts`, Lovable MCP plugin, Nitro preset `vercel`
- `eslint.config.js`: Flat configuration with `typescript-eslint`, React Hooks rules, Prettier integration, and restricted imports (banning Next.js `server-only`)
- `.prettierrc`: 100 print width, double quotes, semicolons, trailing commas
- `vercel.json`: Deployment settings and scheduled health cron (`0 5 * * 1,3,5` -> `/api/health`)

## Platform Requirements

**Development:**
- Node.js 22.x or Bun 1.x
- Git with connection to Lovable repository
- Local dev server: `npm run dev` (Vite dev on port 3000/dynamic)

**Production:**
- Vercel Serverless / Edge Platform (Nitro `vercel` preset)
- Managed Supabase PostgreSQL 17 project with PostgREST, Auth, Storage, and Realtime enabled

---

*Stack analysis: 2026-11-04*
