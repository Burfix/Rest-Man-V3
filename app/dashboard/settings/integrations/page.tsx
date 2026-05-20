/**
 * Settings → Integrations page
 * Matches the existing settings aesthetic: same card style, same typography.
 *
 * Visibility rules:
 *  - Single-site roles (gm, etc.):  one card for ctx.siteId only
 *  - Multi-site roles (head_office, super_admin, executive, auditor, area_manager):
 *      one card per site in ctx.siteIds — cookie selection does NOT hide other sites
 */

import { getMicrosStatus }               from "@/services/micros/status";
import { getMicrosConfigStatus }         from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus } from "@/lib/integrations/status";
import { sanitizeMicrosError }           from "@/lib/integrations/status";
import { createServerClient }            from "@/lib/supabase/server";
import { getUserContext }                from "@/lib/auth/get-user-context";
import MicrosSettingsCard                from "@/components/dashboard/settings/MicrosSettingsCard";
import MicrosDebugPanel                  from "@/components/dashboard/settings/MicrosDebugPanel";
import SyncHealthPanel                   from "@/components/settings/SyncHealthPanel";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);

interface SyncHealthRow {
  sync_type: string;
  last_synced_at: string | null;
  last_outcome: string | null;
  consecutive_failures: number;
  is_overdue: boolean;
  total_runs_today: number;
  next_run_eta: string | null;
}

interface SiteIntegration {
  siteId:          string;
  siteName:        string;
  microsResult:    Awaited<ReturnType<typeof getMicrosStatus>> | null;
  labourLastSyncAt: string | null;
}

export default async function IntegrationsPage() {
  const ctx      = await getUserContext().catch(() => null);
  const supabase = createServerClient();

  if (!ctx) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center">
        <p className="text-sm text-stone-500">You do not have permission to view integrations.</p>
      </div>
    );
  }

  const isMultiSite = MULTI_SITE_ROLES.has(ctx.role);
  const visibleSiteIds = isMultiSite ? ctx.siteIds : [ctx.siteId];

  // ── Parallel fetches ──────────────────────────────────────────────────

  const [siteRows, userRes, healthRes, labourRes, ...microsResults] = await Promise.all([
    // Fetch site names for visible sites
    supabase
      .from("sites")
      .select("id, name")
      .in("id", visibleSiteIds),

    // Auth user (for admin panel)
    supabase.auth.getUser().catch(() => ({ data: { user: null } })),

    // Sync health monitor
    (async () => {
      try {
        return await (supabase as never as { from: (t: string) => any })
          .from("sync_health_monitor")
          .select("sync_type, last_synced_at, last_outcome, consecutive_failures, is_overdue, total_runs_today, next_run_eta")
          .order("is_overdue", { ascending: false })
          .order("sync_type", { ascending: true });
      } catch {
        return { data: null };
      }
    })(),

    // Labour sync state (global — best effort)
    supabase
      .from("labour_sync_state")
      .select("loc_ref, last_sync_at")
      .order("last_sync_at", { ascending: false }),

    // One getMicrosStatus call per visible site
    ...visibleSiteIds.map((id) => getMicrosStatus(id).catch(() => null)),
  ]);

  // Build loc_ref → last_sync_at map for labour status per site
  const labourByLocRef: Record<string, string | null> = {};
  for (const row of (labourRes.data ?? []) as { loc_ref: string; last_sync_at: string | null }[]) {
    if (row.loc_ref && !(row.loc_ref in labourByLocRef)) {
      labourByLocRef[row.loc_ref] = row.last_sync_at;
    }
  }

  // Build siteId → site name map
  const siteNameById: Record<string, string> = {};
  for (const s of (siteRows.data ?? []) as { id: string; name: string }[]) {
    siteNameById[s.id] = s.name;
  }

  // Assemble per-site integration data
  const integrations: SiteIntegration[] = visibleSiteIds.map((siteId, i) => {
    const microsResult = microsResults[i] as Awaited<ReturnType<typeof getMicrosStatus>> | null;
    const locRef = microsResult?.connection?.loc_ref ?? null;
    return {
      siteId,
      siteName: siteNameById[siteId] ?? siteId,
      microsResult,
      labourLastSyncAt: locRef ? (labourByLocRef[locRef] ?? null) : null,
    };
  });

  const cfgStatus    = getMicrosConfigStatus();
  const user         = userRes.data.user;
  const role         = (user?.user_metadata?.role as string | undefined) ??
                       (user?.app_metadata?.role  as string | undefined) ?? "";
  const isAdmin      = role === "admin" || role === "super_admin";
  const syncHealthRows = (healthRes.data ?? []) as SyncHealthRow[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Integrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Connect third-party data sources to power live operational intelligence.
        </p>
      </div>

      {integrations.length === 0 && (
        <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
          <p className="text-sm text-stone-500">No integrations configured for your visible sites.</p>
        </div>
      )}

      {integrations.map(({ siteId, siteName, microsResult, labourLastSyncAt }) => {
        const connection   = microsResult?.connection ?? null;
        const microsHealth = deriveMicrosIntegrationStatus(
          microsResult, cfgStatus.configured, cfgStatus.enabled,
        );
        return (
          <MicrosSettingsCard
            key={siteId}
            siteId={siteId}
            siteName={isMultiSite ? siteName : undefined}
            connection={connection as never}
            microsHealth={microsHealth}
            labourLastSyncAt={labourLastSyncAt}
          />
        );
      })}

      {/* Live data health — is my data trustworthy right now? */}
      <SyncHealthPanel rows={syncHealthRows} />

      {/* Admin-only: MICROS config diagnostics panel */}
      {isAdmin && integrations.length > 0 && (() => {
        // Show debug panel for the primary site's connection
        const primary = integrations.find((i) => i.siteId === ctx.siteId) ?? integrations[0];
        const conn = primary?.microsResult?.connection ?? null;
        return (
          <MicrosDebugPanel
            lastSyncError={
              conn?.last_sync_error
                ? sanitizeMicrosError(conn.last_sync_error)
                : null
            }
            connectionStatus={conn?.status ?? null}
          />
        );
      })()}

      {/* Future integration slots */}
      <section className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-6">
        <h2 className="text-sm font-semibold text-stone-500">More integrations</h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Upcoming: Google Reviews sync, WhatsApp automation, compliance feed.
        </p>
      </section>
    </div>
  );
}
