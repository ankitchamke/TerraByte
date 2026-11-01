import { createFileRoute } from "@tanstack/react-router";
import { handleTranscriptionRequest } from "@/lib/services/transcription-service";

/**
 * Voice Transcription API (/api/transcribe)
 *
 * POST:
 * Authenticated voice transcription using Groq-hosted Whisper Large V3.
 * Supports automatic language detection for Hindi, Marathi, and English.
 * Strictly enforces user authentication and farmer authorization.
 * Transient audio processing only — recordings are never persisted.
 */
export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleTranscriptionRequest(request);
      },
    },
  },
});
