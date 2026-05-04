import { StatusBadge } from "./StatusBadge";
import type { SystemHealthPayload } from "@/lib/system-health/types";

interface SystemHealthOverviewProps {
  payload: SystemHealthPayload;
}

function formatAgo(isoTs: string | null): string {
  if (!isoTs) return "—";
  const mins = Math.round((Date.now() - new Date(isoTs).getTime()) / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function FreshnessBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" :
    score >= 50 ? "bg-amber-500" :
    "bg-red-500";
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
      <div
        className={`h-1.5 rounded-full transition-all ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export default function SystemHealthOverview({ payload }: SystemHealthOverviewProps) {
  const {
    overallStatus,
    summary,
    lastSuccessfulSync,
    failedJobs24h,
    openCriticalActions,
    dataFreshnessScore,
    checkedAt,
  } = payload;

  const cards = [
    {
      label: "Last Successful Sync",
      value: formatAgo(lastSuccessfulSync),
      sub:   lastSuccessfulSync ? new Date(lastSuccessfulSync).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "No data",
      accent: lastSuccessfulSync && Date.now() - new Date(lastSuccessfulSync).getTime() < 60 * 60_000
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Failed Jobs (24h)",
      value: String(failedJobs24h),
      sub:   failedJobs24h === 0 ? "All jobs healthy" : `${failedJobs24h} failure${failedJobs24h !== 1 ? "s" : ""}`,
      accent: failedJobs24h === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
    },
    {
      label: "Open Critical Actions",
      value: String(openCriticalActions),
      sub:   openCriticalActions === 0 ? "No critical actions" : "Require attention",
      accent: openCriticalActions === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
    },
    {
      label: "Data Freshness Score",
      value: `${dataFreshnessScore}%`,
      sub:   <FreshnessBar score={dataFreshnessScore} />,
      accent: dataFreshnessScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : dataFreshnessScore >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400",
    },
  ];

  const statusBorderMap: Record<string, string> = {
    healthy:  "border-l-4 border-l-emerald-500",
    degraded: "border-l-4 border-l-amber-500",
    critical: "border-l-4 border-l-red-500",
  };

  return (
    <section className="space-y-4">
      {/* Hero status */}
      <div className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 ${statusBorderMap[overallStatus]}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <StatusBadge status={overallStatus} />
              <span className="text-xs text-zinc-400">
                Checked {formatAgo(checkedAt)}
              </span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
          >
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              {card.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${card.accent}`}>
              {card.value}
            </p>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              {card.sub}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
