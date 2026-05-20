/**
 * /dashboard/head-office/compliance
 *
 * Head-Office Compliance Command screen.
 * Aggregated single-screen view of precinct compliance health.
 *
 * Access: super_admin | executive | head_office | area_manager
 */

import { getUserContext }            from "@/lib/auth/get-user-context";
import { redirect }                  from "next/navigation";
import ComplianceCommandClient       from "@/components/dashboard/compliance/ComplianceCommandClient";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

const ALLOWED = ["super_admin", "executive", "head_office", "area_manager"];

export default async function HeadOfficeCompliancePage() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch {
    redirect("/login");
  }

  if (!ALLOWED.includes(ctx.role ?? "")) {
    redirect("/dashboard");
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
          Compliance Command Center
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          V&amp;A Waterfront Precinct — live certificate compliance, risk radar and audit readiness
        </p>
      </div>

      <ComplianceCommandClient />
    </div>
  );
}
