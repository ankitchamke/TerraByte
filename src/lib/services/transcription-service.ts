import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MODEL = "whisper-large-v3";
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB limit (well below Groq 25 MB ceiling)
export const MIN_AUDIO_BYTES = 100; // Minimum audio payload
export const MAX_REQUESTS_PER_MINUTE = 10;
export const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout

const CANONICAL_SUPABASE_URL = "https://hwdrypkvszwrcraujctw.supabase.co";
const CANONICAL_SUPABASE_KEY = "sb_publishable_N5Najdw3CfFpFv3gNy0sdA_HNGtdRrq";

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
]);

export const ALLOWED_AUDIO_EXTENSIONS = new Set([
  ".webm",
  ".mp4",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
  ".mp3",
  ".flac",
  ".oga",
]);

// In-memory sliding window rate limiter per authenticated user ID
const userRequestTimestamps = new Map<string, number[]>();

export function checkUserRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60000;
  const timestamps = (userRequestTimestamps.get(userId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return true;
  }
  timestamps.push(now);
  userRequestTimestamps.set(userId, timestamps);
  return false;
}

export function clearRateLimitsForTesting(): void {
  userRequestTimestamps.clear();
}

export function getGroqApiKey(explicitKey?: string): string | undefined {
  if (explicitKey) return explicitKey;
  const processEnv = typeof process !== "undefined" && process?.env ? process.env : undefined;
  if (processEnv?.["GROQ_API_KEY"]) return processEnv["GROQ_API_KEY"];

  // Local development fallback to inspect .env when process.env is not yet populated
  try {
    if (typeof process !== "undefined" && typeof process.cwd === "function") {
      const fs = require("node:fs");
      const path = require("node:path");
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const lines: string[] = fs.readFileSync(envPath, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("GROQ_API_KEY=")) {
            const val = trimmed.slice("GROQ_API_KEY=".length).trim();
            const cleaned = val.replace(/^["']|["']$/g, "").trim();
            if (cleaned) return cleaned;
          }
        }
      }
    }
  } catch {
    // Ignore in bundled/serverless environments
  }
  return undefined;
}

function getSupabaseConfig() {
  const processEnv = typeof process !== "undefined" && process?.env ? process.env : undefined;
  const url =
    processEnv?.["SUPABASE_URL"] || processEnv?.["VITE_SUPABASE_URL"] || CANONICAL_SUPABASE_URL;
  const key =
    processEnv?.["SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv?.["SUPABASE_ANON_KEY"] ||
    processEnv?.["VITE_SUPABASE_ANON_KEY"] ||
    CANONICAL_SUPABASE_KEY;
  return { url, key };
}

export interface TranscriptionHandlerOptions {
  groqApiKey?: string;
  fetchFn?: typeof fetch;
  mockUserClient?: SupabaseClient;
  bypassAuthForTesting?: {
    userId: string;
    role: string;
  };
}

/**
 * Handles incoming POST /api/transcribe requests.
 * Authenticates caller via Supabase Bearer token, validates audio payload,
 * forwards to Groq Whisper Large V3 with automatic language detection,
 * and returns the original-language transcript.
 */
export async function handleTranscriptionRequest(
  request: Request,
  options?: TranscriptionHandlerOptions,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Authenticate caller bearer token
  let userId: string;
  let userRole: string;

  if (options?.bypassAuthForTesting) {
    userId = options.bypassAuthForTesting.userId;
    userRole = options.bypassAuthForTesting.role;
  } else {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+([^\s,]+)$/i);
    const token = match?.[1];

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Authentication required. Missing Bearer token." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
    const userClient =
      options?.mockUserClient ||
      createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session. Please sign in again." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    userId = user.id;

    // Check user profile role via get_session_profile RPC (with fallback for test mock clients)
    let profile: { id: string; role: string } | null = null;
    let profileError: { message: string } | null = null;

    const clientWithRpc = userClient as unknown as {
      rpc?: (fn: string) => Promise<{
        data: Array<{ id: string; role: string }> | null;
        error: { message: string } | null;
      }>;
    };

    if (typeof clientWithRpc.rpc === "function") {
      const { data: sessionData, error } = await clientWithRpc.rpc("get_session_profile");
      profile = sessionData && sessionData.length > 0 ? (sessionData[0] ?? null) : null;
      profileError = error;
    }

    if (!profile) {
      const res = await userClient
        .from("profiles")
        .select("id, role")
        .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`)
        .maybeSingle();
      profile = res.data ?? null;
      profileError = res.error;
    }

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Could not find profile for authenticated user." }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    userRole = profile.role;
  }

  // Enforce farmer (or admin testing) authorization
  if (userRole !== "farmer" && userRole !== "admin") {
    return new Response(
      JSON.stringify({
        error: "Voice transcription for breakdown reports is authorized for farmers.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Rate limiting check
  if (checkUserRateLimit(userId)) {
    return new Response(
      JSON.stringify({
        error: "Too many transcription requests. Please wait a moment before trying again.",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Parse and validate audio multipart body
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid multipart form data in request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const audioFile = formData.get("file");
  if (!audioFile || typeof audioFile !== "object" || !("size" in audioFile)) {
    return new Response(
      JSON.stringify({ error: "Missing audio file in request. Form field 'file' is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const blob = audioFile as Blob & { name?: string };

  if (blob.size < MIN_AUDIO_BYTES) {
    return new Response(
      JSON.stringify({
        error: "Audio recording is empty or too short. Please speak clearly and try again.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (blob.size > MAX_AUDIO_BYTES) {
    return new Response(
      JSON.stringify({
        error:
          "Audio recording exceeds the 10 MB size limit. Please keep voice recordings concise.",
      }),
      {
        status: 413,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Validate MIME type or file extension
  const rawType = (blob.type || "").toLowerCase().trim();
  const baseMime = rawType.split(";")[0]?.trim() || "";
  const filename = blob.name || "recording.webm";
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch && extMatch[1] ? `.${extMatch[1].toLowerCase()}` : "";

  const isValidMime =
    ALLOWED_AUDIO_MIME_TYPES.has(rawType) || ALLOWED_AUDIO_MIME_TYPES.has(baseMime);
  const isValidExt = ALLOWED_AUDIO_EXTENSIONS.has(ext);

  if (!isValidMime && !isValidExt) {
    return new Response(
      JSON.stringify({
        error:
          "Unsupported audio format. Supported formats include WebM, MP4, M4A, Ogg, WAV, and MP3.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 3. Check Groq API configuration
  const groqApiKey = getGroqApiKey(options?.groqApiKey);
  if (!groqApiKey) {
    return new Response(
      JSON.stringify({
        error:
          "Voice transcription service is temporarily unavailable. Please use keyboard typing.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 4. Construct Groq Whisper request
  // Note: We deliberately OMIT the "language" parameter so Whisper automatically detects
  // Hindi, Marathi, English, etc. and transcribes in the original spoken language.
  const groqFormData = new FormData();
  const safeFilename = filename.includes(".")
    ? filename
    : `recording.${ext ? ext.replace(".", "") : "webm"}`;

  groqFormData.append("file", blob, safeFilename);
  groqFormData.append("model", GROQ_MODEL);
  groqFormData.append("response_format", "json");

  const fetchFn = options?.fetchFn || fetch;

  try {
    const groqResponse = await fetchFn(GROQ_WHISPER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: groqFormData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!groqResponse.ok) {
      if (groqResponse.status === 401) {
        return new Response(
          JSON.stringify({
            error: "Transcription service authentication error. Please report this to support.",
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (groqResponse.status === 429) {
        return new Response(
          JSON.stringify({
            error:
              "Transcription service is busy due to high demand. Please try again shortly or type your description.",
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (groqResponse.status === 413) {
        return new Response(
          JSON.stringify({
            error: "Audio recording was rejected as too large by the transcription service.",
          }),
          {
            status: 413,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          error: "Transcription service encountered an error. Please try again or type below.",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await groqResponse.json().catch(() => null);
    if (!data || typeof data.text !== "string") {
      return new Response(
        JSON.stringify({
          error: "Invalid transcription response received from service.",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Preserve the original returned transcript faithfully
    const transcript = data.text.trim();

    return new Response(
      JSON.stringify({
        text: transcript,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      return new Response(
        JSON.stringify({
          error: "Transcription request timed out. Please try again with a shorter recording.",
        }),
        {
          status: 504,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Network error connecting to transcription service. Please try again.",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
