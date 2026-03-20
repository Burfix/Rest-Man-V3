/**
 * services/micros/status.ts
 *
 * Queries for MICROS connection state, last sync run, and latest daily data.
 * Used by GET /api/micros/status and the settings page.
 */

import { createServerClient }   from "@/lib/supabase/server";
import { sanitizeMicrosError }  from "@/lib/integrations/status";
import type { MicrosStatusSummary, MicrosConnection, MicrosSyncRun, MicrosSalesDaily } from "@/types/micros";

const SAFE_CONNECTION_COLUMNS =
  "id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at";

/**
 * Returns the full status summary for the dashboard freshness bar and settings page.
 * Never returns access_token or token_expires_at.
 */
export async function getMicrosStatus(): Promise<MicrosStatusSummary> {
  const supabase = createServerClient();

  const [connRes, runRes] = await Promise.all([
    supabase
      .from("micros_connections")
      .select(SAFE_CONNECTION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("micros_sync_runs")
      .select("id, connection_id, sync_type, started_at, completed_at, status, records_fetched, records_inserted, error_message")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const connection = (connRes.data as MicrosConnection | null) ?? null;
  const lastRun    = (runRes.data as MicrosSyncRun | null) ?? null;

  // Sanitize any stale legacy error text before it propagates to UI
  if (connection?.last_sync_error) {
    const sanitized = sanitizeMicrosError(connection.last_sync_error);
    // Only overwrite if sanitization changed the value (avoid unnecessary mutation)
    if (sanitized !== connection.last_sync_error) {
      (connection as MicrosConnection & { last_sync_error: string }).last_sync_error = sanitized;
    }
  }

  // Fetch latest daily sales row if connected
  let latestDailySales: MicrosSalesDaily | null = null;
  if (connection?.id) {
    const { data } = await supabase
      .from("micros_sales_daily")
      .select("*")
      .eq("connection_id", connection.id)
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestDailySales = (data as MicrosSalesDaily | null) ?? null;
  }

  const isConfigured =
    !!connection &&
    !!connection.auth_server_url &&
    !!connection.app_server_url &&
    !!connection.client_id &&
    !!connection.org_identifier &&
    !!connection.loc_ref;

  // Minutes since last sync
  let minutesSinceSync: number | null = null;
  if (connection?.last_sync_at) {
    minutesSinceSync = Math.floor(
      (Date.now() - new Date(connection.last_sync_at).getTime()) / 60_000,
    );
  }

  return { connection, isConfigured, lastRun, latestDailySales, minutesSinceSync };
}

/**
 * Loads the connection row for use in sync services.
 * Never returns the token fields.
 */
export async function getMicrosConnection(): Promise<MicrosConnection | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("micros_connections")
    .select(SAFE_CONNECTION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MicrosConnection | null) ?? null;
}
