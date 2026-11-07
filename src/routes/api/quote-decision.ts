import { createFileRoute } from "@tanstack/react-router";
import { handleQuoteDecisionRequest } from "@/lib/services/quote-action-handler";

/**
 * Quote Decision API Route (/api/quote-decision)
 *
 * POST:
 * Authenticates farmer/admin user session, verifies that the target quotation is the latest
 * pending revision, enforces machinery ownership, and executes quote approval or rejection
 * with synchronized repair advancement, timeline auditing, and technician alerts.
 */
export const Route = createFileRoute("/api/quote-decision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleQuoteDecisionRequest(request);
      },
    },
  },
});
