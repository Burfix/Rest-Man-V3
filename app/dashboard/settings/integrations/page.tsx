/**
 * Settings → Integrations page
 * Matches the existing settings aesthetic: same card style, same typography.
 */

import { getMicrosStatus }               from "@/services/micros/status";
import { getMicrosConfigStatus }         from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus } from "@/lib/integrations/status";
import { sanitizeMicrosError }           from "@/lib/integrations/status";
import { createServerClient }            from "@/lib/supabase/server";
import MicrosSettingsCard                from "@/components/dashboard/settings/MicrosSettingsCard";
import MicrosDebugPanel                  from "@/components/dashboard/settings/MicrosDebugPanel";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function IntegrationsPage() {
  const supabase = createServerClient();

  const [microsResult, labourRes, userRes] = await Promise.all([
    getMicrosStatus().catch(() => null),
    supabase
      .from("labour_sync_state")
      .select("last_sync_at, last_bus_dt, error_message")
      .order("last_sync_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.auth.getUser().catch(() => ({ data: { user: null } })),
  ]);

  const connection      = microsResult?.connection ?? null;
  const cfgStatus       = getMicrosConfigStatus();
  const microsHealth    = deriveMicrosIntegrationStatus(
    microsResult, cfgStatus.configured, cfgStatus.enabled,
  );
  const labourLastSyncAt = labourRes.data?.last_sync_at ?? null;

  const user    = userRes.data.user;
  const role    = (user?.user_metadata?.role as string | undefined) ??
                  (user?.app_metadata?.role  as string | undefined) ?? "";
  const isAdmin = role === "admin";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Integrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Connect third-party data sources to power live operational intelligence.
        </p>
      </div>

      <MicrosSettingsCard
        connection={connection as never}
        microsHealth={microsHealth}
        labourLastSyncAt={labourLastSyncAt}
      />

      {/* Admin-only: MICROS config diagnostics panel */}
      {isAdmin && (
        <MicrosDebugPanel
          lastSyncError={
            connection?.last_sync_error
              ? sanitizeMicrosError(connection.last_sync_error)
              : null
          }
          connectionStatus={connection?.status ?? null}
        />
      )}

      {/* Future integration slots — placeholder style matches empty maintenance card */}
      <section className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-6">
        <h2 className="text-sm font-semibold text-stone-500">More integrations</h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Upcoming: Google Reviews sync, WhatsApp automation, compliance feed.
        </p>
      </section>
    </div>
  );
}
