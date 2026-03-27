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

  const [connRes, v1RunRes, v2RunRes] = await Promise.all([
    supabase
      .from("micros_connections")
      .select(SAFE_CONNECTION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // V1 sync run history
    supabase
      .from("micros_sync_runs")
      .select("id, connection_id, sync_type, started_at, completed_at, status, records_fetched, records_inserted, error_message")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // V2 sync engine run history (sales only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from("sync_runs") as any)
      .select("id, status, started_at, completed_at, records_fetched, records_written, error_message")
      .eq("sync_type", "sales")
      .eq("source", "micros")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() as Promise<{ data: { id: string; status: string; started_at: string; completed_at: string | null; records_fetched: number; records_written: number; error_message: string | null } | null }>,
  ]);

  const connection = (connRes.data as MicrosConnection | null) ?? null;
  const v1Run      = (v1RunRes.data as MicrosSyncRun | null) ?? null;
  const v2Run      = v2RunRes.data ?? null;

  // Promote V2 run to MicrosSyncRun shape if it's more recent than V1
  let lastRun: MicrosSyncRun | null = v1Run;
  if (v2Run) {
    const v2StartedAt = v2Run.started_at ? new Date(v2Run.started_at).getTime() : 0;
    const v1StartedAt = v1Run?.started_at ? new Date(v1Run.started_at).getTime() : 0;
    if (v2StartedAt >= v1StartedAt) {
      lastRun = {
        id:               v2Run.id,
        connection_id:    connection?.id ?? "",
        sync_type:        "full",
        started_at:       v2Run.started_at,
        completed_at:     v2Run.completed_at,
        status:           v2Run.status as MicrosSyncRun["status"],
        records_fetched:  v2Run.records_fetched ?? 0,
        records_inserted: v2Run.records_written ?? 0,
        error_message:    v2Run.error_message ?? null,
      };
    }
  }

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
