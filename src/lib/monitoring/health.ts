import { telemetryConfig } from "@/config/telemetry";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { createClient } from "@supabase/supabase-js";

export interface SanitizedHealthResponse {
  status: "healthy" | "unhealthy" | "error";
  timestamp: string;
  checks?: {
    database: "operational" | "error";
  };
  message?: string;
}

/**
 * Validates that a key is strictly a public low-privilege key:
 * 1. An opaque public publishable key starting with 'sb_publishable_'.
 * 2. Or a legacy anonymous JWT whose decoded payload role is strictly 'anon'.
 *
 * Rejects 'sb_secret_', service-role keys, and any key with a non-anon role,
 * even if placed in an anon/publishable-named environment variable.
 * Never logs key material.
 */
function isValidPublicKey(key: string): boolean {
  if (!key || typeof key !== "string") {
    return false;
  }

  // Reject any secret key format immediately
  if (key.startsWith("sb_secret_")) {
    return false;
  }

  // Accept opaque public publishable keys
  if (key.startsWith("sb_publishable_")) {
    return true;
  }

  // Check legacy JWT format (header.payload.signature)
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payloadPart = parts[1];
      if (!payloadPart) return false;
      const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const jsonStr = Buffer.from(base64, "base64").toString("utf8");
      const payload = JSON.parse(jsonStr);
      // Strictly require role === 'anon'
      return Boolean(payload && payload.role === "anon");
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Checks whether the key is in the opaque Supabase publishable format.
 */
function isPublishableApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_");
}

/**
 * Creates a custom fetch wrapper ensuring opaque publishable keys do not get
 * improperly attached as Bearer tokens, consistent with auth-middleware.ts conventions.
 */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      isPublishableApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Resolves Supabase connection configuration from server-side environment variables.
 * Strictly verifies that candidate keys are public anon/publishable keys.
 * Never uses service-role or secret keys. Never logs key material.
 */
function getSupabaseServerConfig(): { url: string; key: string } | null {
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  if (!processEnv) return null;

  const url = processEnv["SUPABASE_URL"] || processEnv["VITE_SUPABASE_URL"];
  const candidateKey =
    processEnv["SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv["SUPABASE_ANON_KEY"] ||
    processEnv["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    processEnv["VITE_SUPABASE_ANON_KEY"];

  if (!url || !candidateKey) {
    return null;
  }

  // Fail closed if candidate key is not verified as a low-privilege public key
  if (!isValidPublicKey(candidateKey)) {
    console.error(
      "[Health] Configured Supabase key failed public key validation (privileged or unrecognized key format rejected).",
    );
    return null;
  }

  return { url, key: candidateKey };
}

/**
 * Executes a protected health check probe.
 *
 * Security & Invariants:
 * 1. Delegates authentication strictly to authenticateCronRequest helper before any Supabase client creation.
 * 2. If CRON_SECRET is missing or unauthorized, returns the auth error response immediately.
 * 3. Query parameter secrets (?secret= / ?token=) are rejected by authenticateCronRequest.
 * 4. Only uses public anon/publishable keys with custom fetch handling. Never uses service-role keys.
 * 5. Returns a sanitized response. Does not expose raw database error messages in responses or logs.
 */
export async function runHealthCheck(request: Request): Promise<Response> {
  // 1. Authenticate cron request before creating Supabase client or probing database
  const authResponse = await authenticateCronRequest(request);
  if (authResponse) {
    return authResponse;
  }

  // 2. Resolve server database configuration (URL and public anon/publishable key)
  const dbConfig = getSupabaseServerConfig();
  if (!dbConfig) {
    console.error("[Health] Database configuration unavailable in server environment.");
    const responseBody: SanitizedHealthResponse = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      checks: {
        database: "error",
      },
      message: "Database configuration unavailable",
    };
    return new Response(JSON.stringify(responseBody, null, 2), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // 3. Execute low-privilege database probe using public anon/publishable key
  let dbStatus: "operational" | "error" = "operational";
  try {
    const client = createClient(dbConfig.url, dbConfig.key, {
      global: {
        fetch: createSupabaseFetch(dbConfig.key),
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Query profiles.id with limit(1) using public anon/publishable credentials.
    // Note: Live PostgREST schema permission for role 'anon' to execute SELECT on 'profiles'
    // is unconfirmed in repository migrations and must be verified on the live instance.
    // An RLS filter evaluates only if table-level SELECT is granted.
    const { error } = await client
      .from(telemetryConfig.probeTable)
      .select(telemetryConfig.probeColumn)
      .limit(1);

    if (error) {
      console.error("[Health] Database connectivity probe returned error status.");
      dbStatus = "error";
    }
  } catch {
    console.error("[Health] Database connectivity probe threw an exception.");
    dbStatus = "error";
  }

  // 4. Construct sanitized minimal health response
  const isHealthy = dbStatus === "operational";
  const responseBody: SanitizedHealthResponse = {
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbStatus,
    },
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    status: isHealthy ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
