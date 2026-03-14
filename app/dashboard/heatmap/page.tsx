/**
 * Zone Risk Heatmap — /dashboard/heatmap
 *
 * Server component: loads cached zone risk scores from risk_scores table,
 * then hands off to ZoneHeatmap (client component) for interactive display.
 *
 * Recompute button in ZoneHeatmap calls POST /api/risk/recompute
 * which runs the full scoring engine and updates the cache.
 */

import { getCachedZoneSummaries } from "@/services/universal/zoneSummary";
import { DEFAULT_SITE_ID } from "@/types/universal";
import ZoneHeatmap from "@/components/dashboard/ops/ZoneHeatmap";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HeatmapPage() {
  let zones = await getCachedZoneSummaries(DEFAULT_SITE_ID).catch(() => []);

  const computedAt =
    zones.find((z) => z.last_computed_at)?.last_computed_at ?? null;

  // Derive overall status summary for the page title chip
  const redCount   = zones.filter((z) => z.status === "red").length;
  const amberCount = zones.filter((z) => z.status === "amber").length;
  const overallStatus =
    redCount > 0 ? "red" : amberCount > 0 ? "amber" : "green";

  const overallChip = {
    green: { label: "All Clear",         cls: "bg-emerald-100 text-emerald-800" },
    amber: { label: "Attention Required", cls: "bg-amber-100 text-amber-800"   },
    red:   { label: "At Risk",            cls: "bg-red-100 text-red-800"        },
  }[overallStatus];

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗺️</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-stone-900">Zone Risk Heatmap</h1>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${overallChip.cls}`}
              >
                {overallChip.label}
              </span>
            </div>
            <p className="text-sm text-stone-500">
              Live risk score per zone — tickets, obligations, assets, and event conflicts.
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-3 flex-wrap">
          <QuickStat
            icon="🏠"
            label="Zones"
            value={zones.length}
            color="text-stone-700"
          />
          <QuickStat
            icon="🔴"
            label="At Risk"
            value={redCount}
            color={redCount > 0 ? "text-red-700" : "text-stone-400"}
          />
          <QuickStat
            icon="🟡"
            label="Attention"
            value={amberCount}
            color={amberCount > 0 ? "text-amber-700" : "text-stone-400"}
          />
          <QuickStat
            icon="🟢"
            label="Clear"
            value={zones.length - redCount - amberCount}
            color="text-emerald-700"
          />
        </div>
      </div>

      {/* How-to banner if no data yet */}
      {zones.length === 0 && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-semibold text-blue-800">
            No risk scores computed yet
          </p>
          <p className="mt-1 text-sm text-blue-700">
            Click <strong>Recompute Risk</strong> below to run the scoring engine for
            the first time. The engine reads open tickets, overdue obligations, OOS assets,
            and upcoming events then writes scores to the cache.
          </p>
        </div>
      )}

      {/* Interactive heatmap */}
      <ZoneHeatmap
        initialZones={zones}
        initialComputedAt={computedAt}
        siteId={DEFAULT_SITE_ID}
      />
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3.5 py-2 shadow-sm">
      <span className="text-sm">{icon}</span>
      <div>
        <p className={`text-sm font-bold leading-none ${color}`}>{value}</p>
        <p className="text-[10px] text-stone-400 uppercase tracking-wide">{label}</p>
      </div>
    </div>
  );
}
