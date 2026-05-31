/**
 * /dashboard/head-office/sites — Head Office Sites Overview
 *
 * Displays a grid of all accessible sites with per-site KPIs.
 * Clicking a site updates ?site_id= and navigates to the dashboard.
 * Requires: head_office | super_admin | executive | area_manager
 */

import { redirect }                  from "next/navigation";
import { getUserContext, AuthError }  from "@/lib/auth/get-user-context";
import SitesGridClient               from "@/components/dashboard/head-office/SitesGridClient";
import { ELEVATED_ROLES }            from "@/lib/rbac/roles";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function HeadOfficeSitesPage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err) {
    if (err instanceof AuthError && err.statusCode === 401) redirect("/login");
    throw err;
  }

  if (!ELEVATED_ROLES.has(ctx.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">Sites Overview</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Per-site revenue, labour, compliance, and MICROS health
          </p>
        </div>
        <SitesGridClient />
      </div>
    </div>
  );
}
