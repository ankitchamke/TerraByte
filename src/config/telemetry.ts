/**
 * System Telemetry & Diagnostic Probe Configuration
 * Used by /api/health to perform periodic infrastructure and database health checks.
 */

export interface TelemetryConfig {
  /** Target table to perform diagnostic connectivity probes against */
  probeTable: string;
  /** Primary column to select when executing query probes */
  probeColumn: string;
}

export const telemetryConfig: TelemetryConfig = {
  // Low-privilege probe target: profiles table with limit(1)
  // Evaluated via Supabase PostgREST using public anon/publishable key under PostgreSQL RLS
  probeTable: "profiles",
  probeColumn: "id",
};
