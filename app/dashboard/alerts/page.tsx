/**
 * app/dashboard/alerts/page.tsx
 *
 * Manager Alerts dashboard — create, send, and track WhatsApp alerts for managers.
 */

import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { resolvePageSite }           from "@/lib/auth/resolve-site";
import { redirect }                  from "next/navigation";
import { createServerClient }        from "@/lib/supabase/server";
import AlertsPageClient              from "@/components/alerts/AlertsPageClient";

export const dynamic    = "force-dynamic";
export const revalidate = 0;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: {
    site_id?:     string;
    incident_id?: string;
    title?:       string;
    severity?:    string;
    source?:      string;
  };
}) {
  const ctx = await getUserContext().catch((err: unknown) => {
    if (err instanceof AuthError && err.statusCode === 401) redirect("/login");
    return null;
  });

  if (!ctx?.siteId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-500">No site assigned. Contact your administrator.</p>
      </div>
    );
  }

  const { siteId } = resolvePageSite(ctx, searchParams?.site_id);

  const db = createServerClient();

  // Fetch initial data in parallel
  const [contactsRes, alertsRes, sitesRes] = await Promise.allSettled([
    db
      .from("manager_contacts")
      .select("id, site_id, name, role, phone_whatsapp, is_active, alert_preferences, created_at, updated_at")
      .eq("site_id",   siteId)
      .eq("is_active", true)
      .order("name"),

    db
      .from("manager_alerts")
      .select(`
        id, site_id, manager_id, alert_type, severity, source,
        title, message, status, sent_at, acknowledged_at,
        failed_reason, retry_count, incident_id,
        created_at, updated_at,
        manager:manager_contacts (name, role)
      `)
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(50),

    // HQ roles: fetch all accessible sites for the site picker
    ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role)
      ? db.from("sites").select("id, name").order("name")
      : Promise.resolve({ data: null, error: null }),
  ]);

  const contacts = contactsRes.status === "fulfilled" ? (contactsRes.value.data ?? []) : [];
  const alerts   = alertsRes.status   === "fulfilled" ? (alertsRes.value.data   ?? []) : [];
  const sites    = sitesRes.status    === "fulfilled" ? (sitesRes.value.data     ?? []) : [];

  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Manager Alerts
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Send WhatsApp alerts to site managers. Track delivery and acknowledgement.
        </p>
      </div>

      <AlertsPageClient
        initialAlerts={alerts as Parameters<typeof AlertsPageClient>[0]["initialAlerts"]}
        contacts={contacts as Parameters<typeof AlertsPageClient>[0]["contacts"]}
        sites={isHq ? (sites as Parameters<typeof AlertsPageClient>[0]["sites"]) : []}
        currentSiteId={siteId}
        isHq={isHq}
        userId={ctx.userId}
        prefill={
          searchParams?.incident_id
            ? {
                incident_id: searchParams.incident_id,
                title:       searchParams.title ?? "",
                severity:    searchParams.severity ?? "warning",
                source:      searchParams.source  ?? "incident",
              }
            : undefined
        }
      />
    </div>
  );
}
