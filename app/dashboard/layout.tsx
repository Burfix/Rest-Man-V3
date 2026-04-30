import Sidebar from "@/components/dashboard/Sidebar";
import UserProfile from "@/components/dashboard/UserProfile";
import ThemeToggle from "@/components/dashboard/ThemeToggle";
import AutoRefresh from "@/components/dashboard/AutoRefresh";
import ImpersonationBanner from "@/components/admin/ImpersonationBanner";
import RoleGuard from "@/components/dashboard/RoleGuard";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getSiteConfig } from "@/lib/config/site";
import type { UserRole } from "@/lib/ontology/entities";

export const metadata = {
  title: "Dashboard — Ops Engine",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let role: UserRole = "viewer"; // most restrictive fallback
  let siteAllowedRoutes: string[] | null = null;
  let deploymentStage: 'live' | 'partial' | 'pending' = 'live';
  try {
    const ctx = await getUserContext();
    role = ctx.role;
    const siteConfig = await getSiteConfig(ctx.siteId);
    siteAllowedRoutes = siteConfig.allowed_routes;
    deploymentStage = siteConfig.deployment_stage;
  } catch {
    // Middleware handles auth redirects; default to most restrictive role
  }

  return (
    <div className="flex h-screen bg-[#f8f8f6] dark:bg-[#0f0f0e]">
      <ImpersonationBanner />
      <Sidebar role={role} siteAllowedRoutes={siteAllowedRoutes} footer={
        <div>
          <ThemeToggle />
          <UserProfile />
        </div>
      } />
      {/* pt-14 reserves space for the fixed mobile top bar; lg:pt-0 removes it on desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-[72px] lg:p-8 lg:pt-8 bg-[#f8f8f6] dark:bg-[#0f0f0e]">
        {deploymentStage === 'partial' && (
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
