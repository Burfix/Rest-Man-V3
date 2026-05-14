import Sidebar from "@/components/dashboard/Sidebar";
import UserProfile from "@/components/dashboard/UserProfile";
import ThemeToggle from "@/components/dashboard/ThemeToggle";
import AutoRefresh from "@/components/dashboard/AutoRefresh";
import ImpersonationBanner from "@/components/admin/ImpersonationBanner";
import RoleGuard from "@/components/dashboard/RoleGuard";
import SiteSwitcher from "@/components/dashboard/SiteSwitcher";
import type { SiteOption } from "@/components/dashboard/SiteSwitcher";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getSiteConfig } from "@/lib/config/site";
import { createClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/ontology/entities";

export const metadata = {
  title: "Dashboard — Ops Engine",
};

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);

async function fetchSiteOptions(siteIds: string[]): Promise<SiteOption[]> {
  if (siteIds.length === 0) return [];
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data } = await db
      .from("sites")
      .select("id, name")
      .in("id", siteIds)
      .eq("is_active", true)
      .order("name");
    return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let role: UserRole = "viewer";
  let siteAllowedRoutes: string[] | null = null;
  let deploymentStage: "live" | "partial" | "pending" = "live";
  let siteOptions: SiteOption[] = [];
  let currentSiteId = "";

  try {
    const ctx = await getUserContext();
    role = ctx.role;
    currentSiteId = ctx.siteId;

    const siteConfig = await getSiteConfig(ctx.siteId);
    siteAllowedRoutes = siteConfig.allowed_routes;
    deploymentStage   = siteConfig.deployment_stage;

    if (MULTI_SITE_ROLES.has(ctx.role)) {
      siteOptions = await fetchSiteOptions(ctx.siteIds);
    }
  } catch {
    // Middleware handles auth redirects; default to most restrictive
  }

  const siteSwitcher =
    siteOptions.length > 0 ? (
      <SiteSwitcher sites={siteOptions} currentId={currentSiteId || "all"} role={role} />
    ) : null;

  return (
    <div className="flex h-screen bg-[#f8f8f6] dark:bg-[#0f0f0e]">
      <ImpersonationBanner />
      <Sidebar role={role} siteAllowedRoutes={siteAllowedRoutes} siteSwitcher={siteSwitcher} footer={
        <div>
          <ThemeToggle />
          <UserProfile />
        </div>
      } />
      <main className="flex-1 overflow-y-auto p-4 pt-[72px] lg:p-8 lg:pt-8 bg-[#f8f8f6] dark:bg-[#0f0f0e]">
        {deploymentStage === "partial" && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">Awaiting live data</span> — revenue and labour modules are pending POS integration. Scores reflect compliance and maintenance only.
          </div>
        )}
        <AutoRefresh />
        <RoleGuard role={role} siteAllowedRoutes={siteAllowedRoutes}>
          {children}
        </RoleGuard>
      </main>
    </div>
  );
}

