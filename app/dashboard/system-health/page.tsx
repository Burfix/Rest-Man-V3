import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { redirect }                  from "next/navigation";
import { getSystemHealth }           from "@/lib/system-health/getSystemHealth";
import SystemHealthOverview          from "@/components/system-health/SystemHealthOverview";
import DataSourceHealthTable         from "@/components/system-health/DataSourceHealthTable";
import MicrosHealthCard              from "@/components/system-health/MicrosHealthCard";
import JobsHealthTable               from "@/components/system-health/JobsHealthTable";
import ErrorMonitoringCard           from "@/components/system-health/ErrorMonitoringCard";
import RunbookCards                  from "@/components/system-health/RunbookCards";
import OperatorChecklist             from "@/components/system-health/OperatorChecklist";
import RecentIncidentsTable          from "@/components/system-health/RecentIncidentsTable";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function SystemHealthPage() {
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

  const health = await getSystemHealth(ctx.siteId);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">System Health</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Live operational status and recovery console.
        </p>
      </div>

      <SystemHealthOverview payload={health} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DataSourceHealthTable dataSources={health.dataSources} />
        <MicrosHealthCard micros={health.micros} />
      </div>

      <JobsHealthTable jobs={health.jobs} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ErrorMonitoringCard errors={health.errors} />
        <OperatorChecklist initialItems={health.checklist} />
      </div>

      <RunbookCards />

      <RecentIncidentsTable incidents={health.incidents} />
    </div>
  );
}
