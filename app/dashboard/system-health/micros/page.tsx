/**
 * /dashboard/system-health/micros — MICROS Mission Control
 *
 * Server component: fetches health data for all accessible sites,
 * then renders the MicrosCommandCenter client layout.
 */

import { redirect }             from "next/navigation";
import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { getMicrosHealth }      from "@/lib/system-health/getMicrosHealth";
import MicrosCommandCenter      from "@/components/system-health/MicrosCommandCenter";
import { MULTI_SITE_ROLES }     from "@/lib/rbac/roles";

export const dynamic   = "force-dynamic";
export const revalidate = 0;



export default async function MicrosMissionControlPage() {
  // Auth
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err) {
    if (err instanceof AuthError && err.statusCode === 401) {
      redirect("/login");
    }
    throw err;
  }

  const siteIds = MULTI_SITE_ROLES.has(ctx.role) ? "all" : [ctx.siteId];

  let data;
  try {
    data = await getMicrosHealth(siteIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <h1 className="text-2xl font-bold mb-4">MICROS Mission Control</h1>
        <div className="rounded-lg bg-red-950/40 border border-red-700/50 p-4 text-red-300 text-sm">
          Failed to load health data: {msg}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">MICROS Mission Control</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Live health monitoring and manual controls for all MICROS integration points
            </p>
          </div>
        </div>

        <MicrosCommandCenter data={data} />
      </div>
    </div>
  );
}
