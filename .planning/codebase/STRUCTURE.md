# Codebase Structure

**Analysis Date:** 2026-11-04

## Directory Layout

```
TerraByte/
├── .planning/                  # Project memory, roadmap, and GSD planning artifacts
│   └── codebase/               # Codebase reference maps (STACK, ARCHITECTURE, etc.)
├── public/                     # Static web assets (favicons, manifests, public images)
├── src/                        # Application source code
│   ├── components/             # Reusable React UI components
│   │   └── ui/                 # Radix UI and Tailwind design system primitives
│   ├── config/                 # Application configuration (telemetry, constants)
│   ├── hooks/                  # Custom React hooks (realtime subscriptions, responsive layout)
│   ├── integrations/           # Third-party platform integrations
│   │   └── supabase/           # Supabase client, auth helpers, types, and cron auth
│   ├── lib/                    # Core business logic, services, and utilities
│   │   ├── mcp/                # Model Context Protocol tools and registry
│   │   ├── monitoring/         # Health monitoring and database probes
│   │   ├── services/           # Domain business operations (repairs, quotes, parts, etc.)
│   │   └── types/              # Domain TypeScript type definitions
│   ├── routes/                 # TanStack Router file-based route tree
│   │   ├── admin/              # Service Centre dispatcher routes and Parts Desk
│   │   ├── api/                # Server function route handlers (health, routing, diagnostics)
│   │   ├── auth/               # Password confirmation and reset routes
│   │   ├── farmer/             # Farmer portal (breakdown reporting, equipment, repair tracking)
│   │   ├── register/           # Registration flows for farmers and mechanics
│   │   ├── technician/         # Technician workbench and active job routes
│   │   └── [.well-known]/      # OAuth and MCP discovery endpoints
│   ├── router.tsx              # Router initialization and QueryClient binding
│   ├── routeTree.gen.ts        # Generated route tree (TanStack Router)
│   ├── server.ts               # Server entry point with SSR error normalization
│   ├── start.ts                # TanStack Start configuration with CSRF & auth middleware
│   └── styles.css              # Global styles and Tailwind CSS directives
├── supabase/                   # Supabase database configuration
│   └── migrations/             # Timestamped PostgreSQL forward migrations
├── tests/                      # Automated test suite (Node.js test runner)
├── .env.example                # Template for environment variables
├── AGENTS.md                   # Agent guidelines and Lovable sync rules
├── bunfig.toml                 # Bun package manager configuration
├── components.json             # Shadcn / UI configuration
├── eslint.config.js            # Flat ESLint configuration
├── package.json                # Project dependencies and script declarations
├── tsconfig.json               # TypeScript compiler configuration
├── vercel.json                 # Vercel deployment configuration and cron jobs
└── vite.config.ts              # Vite & Nitro build setup
```

## Directory Purposes

**`src/routes/`:**
- Purpose: Defines the entire web URL hierarchy using TanStack Router's file-based routing
- Contains: Page components, layout wrappers (`admin.tsx`, `farmer.tsx`, `technician.tsx`), and API endpoints
- Key files: `src/routes/__root.tsx`, `src/routes/farmer/report-breakdown.tsx`, `src/routes/technician/job/$id.tsx`, `src/routes/admin/parts-desk.tsx`, `src/routes/api/health.ts`

**`src/lib/services/`:**
- Purpose: Domain service layer encapsulating all business operations and database queries
- Contains: Clean async functions for managing repair requests, quotes, parts requisitions, routing, and AI diagnostics
- Key files: `src/lib/services/repair-requests.ts`, `src/lib/services/quotes.ts`, `src/lib/services/parts-desk.ts`, `src/lib/services/routing.ts`, `src/lib/services/gemini-diagnostic.ts`

**`src/components/`:**
- Purpose: Reusable interactive user interface elements
- Contains: Shared domain cards, modal dialogs, and low-level Radix primitives
- Key files: `src/components/parts-pickup-card.tsx`, `src/components/repair-chat.tsx`, `src/components/quote-comparison.tsx`, `src/components/route-estimate-card.tsx`

**`src/integrations/supabase/`:**
- Purpose: Encapsulation of Supabase client connections, middleware, and database schema types
- Contains: Browser client, server client, preview authentication storage, and generated database interface
- Key files: `src/integrations/supabase/client.ts`, `src/integrations/supabase/client.server.ts`, `src/integrations/supabase/types.ts`

**`supabase/migrations/`:**
- Purpose: Version-controlled database schema, RLS policies, PostgreSQL triggers, and stored procedures
- Contains: Deterministic, timestamped `.sql` files executed in sequence
- Key files: `20260930000001_initial_schema.sql`, `20261029100000_phase9_1_parts_pickup.sql`, `20261104100000_profile_security_separation.sql`

**`tests/`:**
- Purpose: Automated test verification executed via native Node.js test runner
- Contains: Standalone `.test.mjs` test files covering migrations, RLS contracts, services, and route handlers
- Key files: `tests/parts-desk.test.mjs`, `tests/profile-security-architecture.test.mjs`, `tests/route-estimate.test.mjs`, `tests/cleanup-verification.test.mjs`

## Key File Locations

**Entry Points:**
- `src/router.tsx`: Client-side router factory and QueryClient integration
- `src/server.ts`: Server-side fetch entry and SSR error normalization
- `src/start.ts`: Server start middleware configuration (CSRF & Supabase Auth)
- `src/routes/__root.tsx`: Document root shell, HTML headers, and toast container

**Configuration:**
- `vite.config.ts`: Vite build, Nitro presets, and Lovable MCP plugins
- `tsconfig.json`: Compiler target (ES2022), strictness, and `@/*` path mapping
- `eslint.config.js`: ESLint rules and server-only import constraints
- `vercel.json`: Vercel cron schedules and deployment guards

**Core Logic:**
- `src/lib/services/repair-requests.ts`: Core repair intake and state transitions
- `src/lib/services/quotes.ts`: Itemized quoting, diffing, and approvals
- `src/lib/services/parts-desk.ts`: Inventory management, requisitions, and audit logs
- `src/lib/matching.ts`: Technician-to-breakdown matching algorithm
- `src/lib/location.ts`: Nagpur district geography and GPS coordinates

**Testing:**
- `tests/parts-desk.test.mjs`: Tests for spare parts catalog, movements, and handoff
- `tests/profile-security-architecture.test.mjs`: Tests for RLS policies, role gates, and auth decoupling

## Naming Conventions

**Files:**
- Kebab-case for TypeScript and TSX files: `repair-requests.ts`, `parts-pickup-card.tsx`
- Upper camel-case strictly avoided for filenames (use `component-error-boundary.tsx` not `ComponentErrorBoundary.tsx`)
- Server files designated by `.server.ts` suffix: `client.server.ts`
- Routes follow TanStack Router conventions: `index.tsx`, `$id.tsx`, `report-breakdown.tsx`
- Migrations: `YYYYMMDDHHMMSS_name.sql`

**Directories:**
- Kebab-case for all source directories: `repair/`, `components/`, `parts-desk/`

**Code Symbols:**
- PascalCase for React components and TypeScript interfaces: `RepairChat`, `Database`, `DiagnosticServiceResult`
- camelCase for functions, methods, hooks, and variables: `createRepairRequest()`, `useRepairTicketRealtime()`
- UPPER_SNAKE_CASE for constants and enum values: `DESIGNATED_DEMO_EMAILS`, `DIAGNOSTIC_LIMITS`

## Where to Add New Code

**New Feature Flow (e.g. New User Flow):**
- Route definition: Create new route file under `src/routes/<role>/` (e.g. `src/routes/farmer/warranty.tsx`)
- Service logic: Add corresponding domain functions in `src/lib/services/`
- UI Components: Place feature-specific UI in `src/components/`
- Types: Add domain schemas in `src/lib/types/`
- Tests: Add corresponding `.test.mjs` test file in `tests/`

**New API Endpoint:**
- Add server route file under `src/routes/api/` (e.g. `src/routes/api/export-invoices.ts`)
- Use `createFileRoute` from TanStack Router and export a standard Request/Response handler

**New Database Migration:**
- Create new timestamped `.sql` file in `supabase/migrations/` using current UTC timestamp: `YYYYMMDDHHMMSS_feature_name.sql`
- Always include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- Include explicit grant statements for `authenticated` and `service_role` roles

**Shared Utilities:**
- Helper functions: Add to `src/lib/` (e.g. `src/lib/date-utils.ts`, `src/lib/location.ts`)
- Design primitives: Add to `src/components/ui/`

## Special Directories

**`.planning/`:**
- Purpose: Contains GSD agent workflow memory, phase plans, and codebase reference maps
- Generated: Managed by GSD agents and developer
- Committed: Yes (tracked in git)

**`src/routeTree.gen.ts`:**
- Purpose: Automatically generated router tree compiled by TanStack Router Vite plugin
- Generated: Yes (updated on dev server start or build)
- Committed: Yes (ensures reproducible CI builds)

**`.output/` & `dist/`:**
- Purpose: Production build artifacts output by Vite and Nitro
- Generated: Yes
- Committed: No (gitignored)

---

*Structure analysis: 2026-11-04*
