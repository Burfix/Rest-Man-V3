import { StatusBadge } from "./StatusBadge";
import type { DataSourceHealth } from "@/lib/system-health/types";

interface DataSourceHealthTableProps {
  dataSources: DataSourceHealth[];
}

function formatAge(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 1)    return "< 1 min";
  if (mins < 60)   return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

const TRUST_LABELS: Record<string, string> = {
  high:   "High",
  medium: "Medium",
  low:    "Low",
  none:   "None",
};

const TRUST_COLORS: Record<string, string> = {
  high:   "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  low:    "text-orange-600 dark:text-orange-400",
  none:   "text-red-600 dark:text-red-400",
};

export default function DataSourceHealthTable({ dataSources }: DataSourceHealthTableProps) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Data Source Health
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Freshness of each data module — stale sources reduce operating trust.
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Source</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Last Success</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Data Age</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Trust</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Recommended Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {dataSources.map(source => (
              <tr key={source.key} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                <td className="px-6 py-3 font-medium text-zinc-800 dark:text-zinc-200">
                  {source.label}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={source.status} />
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                  {formatTs(source.lastSuccess)}
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                  {formatAge(source.dataAgeMinutes)}
                </td>
                <td className={`px-4 py-3 text-xs font-medium ${TRUST_COLORS[source.trust]}`}>
                  {TRUST_LABELS[source.trust]}
                </td>
                <td className="px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
                  {source.action}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {dataSources.map(source => (
          <div key={source.key} className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{source.label}</span>
              <StatusBadge status={source.status} />
            </div>
            <div className="flex gap-4 text-xs text-zinc-500">
              <span>Age: {formatAge(source.dataAgeMinutes)}</span>
              <span className={TRUST_COLORS[source.trust]}>Trust: {TRUST_LABELS[source.trust]}</span>
            </div>
            {source.status !== "live" && source.status !== "fresh" && (
              <p className="text-xs text-zinc-500">{source.action}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
