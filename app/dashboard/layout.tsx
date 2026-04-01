import Sidebar from "@/components/dashboard/Sidebar";
import UserProfile from "@/components/dashboard/UserProfile";
import ThemeToggle from "@/components/dashboard/ThemeToggle";
import AutoRefresh from "@/components/dashboard/AutoRefresh";
import ImpersonationBanner from "@/components/admin/ImpersonationBanner";
import RoleGuard from "@/components/dashboard/RoleGuard";
import { getUserContext } from "@/lib/auth/get-user-context";
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
  try {
    const ctx = await getUserContext();
    role = ctx.role;
  } catch {
    // Middleware handles auth redirects; default to most restrictive role
  }

  return (
    <div className="flex h-screen bg-[#f8f8f6] dark:bg-[#0f0f0e]">
      <ImpersonationBanner />
      <Sidebar role={role} footer={
        <div>
          <ThemeToggle />
          <UserProfile />
        </div>
      } />
      {/* pt-14 reserves space for the fixed mobile top bar; lg:pt-0 removes it on desktop */}
      <main className="flex-1 overflow-y-auto p-4 pt-[72px] lg:p-8 lg:pt-8 bg-[#f8f8f6] dark:bg-[#0f0f0e]">
        <AutoRefresh />
        <RoleGuard role={role}>
          {children}
        </RoleGuard>
      </main>
    </div>
  );
}
