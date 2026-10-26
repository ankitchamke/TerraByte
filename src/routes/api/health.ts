import { createFileRoute } from "@tanstack/react-router";
import { runHealthCheck } from "@/lib/monitoring/health";

/**
 * Health & Liveness Route (/api/health)
 *
 * GET:
 * Diagnostic health check protected by Vercel `CRON_SECRET`.
 * Requires `Authorization: Bearer <CRON_SECRET>`.
 * Executes a low-privilege database connectivity probe against Supabase using anon/publishable keys.
 * Returns sanitized { status: "healthy" | "unhealthy", timestamp, checks: { database } }.
 *
 * HEAD:
 * Lightweight liveness check. Does NOT require authentication and does NOT probe the database.
 * Confirms only that the TanStack Start / Nitro server process is responsive.
 * Note: A 200 response to HEAD does NOT indicate database readiness or dependency availability.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return runHealthCheck(request);
      },
      HEAD: async () => {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Liveness-Only": "true",
          },
        });
      },
    },
  },
});
