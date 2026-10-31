import { createFileRoute } from "@tanstack/react-router";
import { handleRouteEstimateRequest } from "@/lib/services/routing-handler";

/**
 * Route Estimate API (/api/route-estimate)
 *
 * POST:
 * On-demand route calculation for assigned technicians.
 * Computes driving distance and estimated transit time using Google Maps Routes API v2.
 * Strictly enforces user authentication, technician assignment, active repair state,
 * and private destination coordinates via Supabase RLS.
 *
 * Coordinates and route results are transient and never persisted.
 */
export const Route = createFileRoute("/api/route-estimate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleRouteEstimateRequest(request);
      },
    },
  },
});
