# Coding Conventions

**Analysis Date:** 2026-11-04

## Naming Patterns

**Files:**
- Kebab-case for all TypeScript and React files: `repair-requests.ts`, `route-estimate-card.tsx`, `use-repair-realtime.ts`
- Route files match TanStack Router conventions: `index.tsx`, `$id.tsx`, `profile.tsx`
- Server-only modules use `.server.ts` suffix: `client.server.ts`
- SQL migrations formatted with UTC timestamp prefix: `20261029100000_phase9_1_parts_pickup.sql`
- Test files use `.test.mjs` suffix: `parts-desk.test.mjs`

**Functions:**
- camelCase for functions and methods: `createRepairRequest()`, `formatRouteDistance()`, `computeOsrmRoute()`
- React hook names start with `use`: `useRepairTicketRealtime()`, `useMobile()`
- Event handlers prefixed with `handle` or `on`: `handleSubmit()`, `onSelectLocation()`

**Variables & Properties:**
- camelCase for local variables and object properties: `repairId`, `technicianProfile`, `isSubmitting`
- UPPER_SNAKE_CASE for immutable constants and environment identifiers: `CANONICAL_SUPABASE_URL`, `DESIGNATED_DEMO_EMAILS`, `GROQ_WHISPER_URL`
- Database table columns in PostgreSQL snake_case: `created_at`, `repair_request_id`, `is_verified`

**Types & Interfaces:**
- PascalCase for type names, interfaces, and enums: `RepairRequest`, `Database`, `DiagnosticServiceResult`
- Props interfaces named `<Component>Props`: `PartsPickupCardProps`, `DirectionsButtonProps`
- Discriminated union status types in UPPER_SNAKE_CASE: `"REQUESTED" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED"`

## Code Style

**Formatting:**
- Formatter: Prettier 3.7.3 (`.prettierrc`)
- Configuration:
  - `printWidth: 100`
  - `semi: true`
  - `singleQuote: false` (double quotes)
  - `trailingComma: "all"`
  - `endOfLine: "auto"`

**Linting:**
- Linter: ESLint 9.32.0 with Flat Config (`eslint.config.js`)
- Key Rules:
  - `typescript-eslint/recommended`
  - `react-hooks/recommended`
  - `no-restricted-imports`: Disallows Next.js `server-only` (TanStack Start requires `*.server.ts` or `@tanstack/react-start/server-only`)
  - `react-refresh/only-export-components`: Warns against non-component exports in component files

## Import Organization

**Order:**
1. Core runtime & React primitives (`import { useState, useEffect } from "react"`)
2. Framework & router modules (`import { createFileRoute } from "@tanstack/react-router"`)
3. Third-party UI & icon packages (`import { Wrench, MapPin } from "lucide-react"`)
4. Internal UI components (`import { Button } from "@/components/ui/button"`)
5. Services, utilities, and helpers (`import { getRepairRequest } from "@/lib/services/repair-requests"`)
6. Explicit type imports (`import type { Database } from "@/integrations/supabase/types"`)

**Path Aliases:**
- `@/*` maps to `./src/*` (`tsconfig.json`)
- Relative imports allowed for co-located submodules (e.g. `./lib/error-capture`)

## Error Handling

**Patterns:**
- **Explicit Result Objects in Services:** Return `{ success: boolean, error?: string, data?: T }` for complex operations:
  ```typescript
  export interface DiagnosticServiceResult {
    success: boolean;
    status: "ANALYZED" | "RETRYABLE_ERROR" | "FAILED" | "SKIPPED";
    error?: string;
    details?: string;
    data?: GeminiDiagnosticResponse;
  }
  ```
- **API Error Responses:** Server route handlers catch exceptions and respond with structured JSON and canonical HTTP status codes (400, 401, 403, 404, 405, 500):
  ```typescript
  if (!token) {
    return new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  ```
- **Fail-Closed Security Checks:** Authentication and authorization guards fail immediately if caller context is ambiguous or unverified.

## Logging

**Framework:** Native `console` methods (`console.error`, `console.warn`, `console.log`).

**Patterns:**
- Log unhandled runtime exceptions with error objects in server handlers (`console.error(error)`)
- Avoid logging sensitive credentials, JWT tokens, or passwords
- Error capture middleware (`src/lib/error-capture.ts`) preserves errors before Nitro or h3 swallows them

## Comments

**When to Comment:**
- Document complex business state machines (e.g. quote revision workflows and cancellation policies)
- Detail security boundaries and RLS privilege assumptions
- Provide explanation when working around framework behaviors (e.g. Nitro/h3 error swallowing in `src/server.ts`)

**JSDoc/TSDoc:**
- Used on public service functions and API handlers detailing HTTP method, permissions, and contract constraints.

## Function Design

**Size:**
- Single responsibility functions. Complex UI components broken into modular subcards (e.g. `PartsPickupCard` containing requisition dialogs).

**Parameters:**
- Functions with more than two arguments use destructured configuration objects:
  ```typescript
  interface ExecuteDiagnosticParams {
    supabaseAdmin: SupabaseClient<Database>;
    repairRequestId: string;
    claimToken: string;
    executorProfileId: string;
    equipment: { make: string; model: string; year?: number | null };
    symptoms: string[];
    description: string;
    photos: string[];
  }
  ```

**Return Values:**
- Explicit return types declared on all public service methods and API handlers.

## Module Design

**Exports:**
- Named exports are standard across utilities, components, and services
- Default exports reserved for route components and Vite/ESLint configuration files

**Barrel Files:**
- Avoid sprawling index barrel re-exports; import directly from the target module to maintain tree-shaking and fast build times.

---

*Convention analysis: 2026-11-04*
