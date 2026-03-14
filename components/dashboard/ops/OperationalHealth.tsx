/**
 * OperationalHealth
 *
 * Right card of the secondary operations grid.
 * Four horizontal progress bars: Compliance · Maintenance · Revenue · Reputation
 *
 * Each bar: label + percentage text + bar fill + status badge
 */

import { cn } from "@/lib/utils";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  SevenDayReviewSummary,
} from "@/types";

interface Props {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  reviews:     SevenDayReviewSummary;
}

interface HealthBar {
  label:   string;
  pct:     number;       // 0–100
  value:   string;       // displayed text (e.g. "75%" or "4.4 ⭐")
  status:  string;       // short status word
  color:   string;       // Tailwind bg- class for fill
  textClr: string;       // Tailwind text- class for status + value
}

function buildBars(
  compliance:  ComplianceSummary,
  maintenance: MaintenanceSummary,
  forecast:    RevenueForecast | null,
  reviews:     SevenDayReviewSummary
): HealthBar[] {
  // ── Compliance ────────────────────────────────────────────────────────────
  const compPct = compliance.total > 0 ? compliance.compliance_pct : 0;
  const compStatus =
    compliance.expired > 0  ? "Expired"    :
    compliance.due_soon > 0 ? "Due soon"   :
    compliance.total > 0    ? "Current"    :
    "No data";
  const compColor =
    compliance.expired > 0  ? "bg-red-500"    :
    compliance.due_soon > 0 ? "bg-amber-400"  :
    "bg-emerald-500";
  const compText =
    compliance.expired > 0  ? "text-red-600"   :
    compliance.due_soon > 0 ? "text-amber-600" :
    "text-emerald-700";

  // ── Maintenance ───────────────────────────────────────────────────────────
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;
  const totalEquip = maintenance.totalEquipment;
  const maintPct =
    totalEquip === 0
      ? 0
      : Math.round(((totalEquip - totalOpen - maintenance.outOfService) / totalEquip) * 100);
  const maintStatus =
    maintenance.outOfService > 0  ? "Out of SVC"   :
    totalOpen > 0                  ? "Open issues"  :
    totalEquip > 0                 ? "Operational"  :
    "No data";
  const maintColor =
    maintenance.outOfService > 0  ? "bg-red-500"   :
    totalOpen > 0                  ? "bg-amber-400" :
    "bg-emerald-500";
  const maintText =
    maintenance.outOfService > 0  ? "text-red-600"   :
    totalOpen > 0                  ? "text-amber-600" :
    "text-emerald-700";

  // ── Revenue ───────────────────────────────────────────────────────────────
  const gapPct  = forecast?.sales_gap_pct ?? null;
  // Convert gap % to a health % (on target = 100%, -20% gap = 80%, etc.)
  const revPct  =
    !forecast || gapPct === null ? 0 :
    gapPct >= 0                  ? 100 :
    Math.max(0, Math.round(100 + gapPct));
  const revStatus =
    !forecast       ? "No forecast" :
    gapPct === null ? "No target"   :
    gapPct >= 0     ? "On track"    :
    `▼ ${Math.abs(gapPct).toFixed(1)}%`;
  const revColor =
    !forecast ? "bg-stone-300" :
    (gapPct ?? 0) < -20 ? "bg-red-500"    :
    (gapPct ?? 0) < 0   ? "bg-amber-400"  :
    "bg-emerald-500";
  const revText =
    !forecast ? "text-stone-400" :
    (gapPct ?? 0) < -20 ? "text-red-600"   :
    (gapPct ?? 0) < 0   ? "text-amber-600" :
    "text-emerald-700";

  // ── Reputation ────────────────────────────────────────────────────────────
  const avg    = reviews.overallAverage ?? 0;
  const repPct = reviews.totalReviews > 0 ? Math.round((avg / 5) * 100) : 0;
  const repStatus =
    reviews.totalReviews === 0 ? "No data"  :
    avg >= 4.5                  ? "Excellent"  :
    avg >= 4.0                  ? "Good"       :
    avg >= 3.5                  ? "Average"    :
    "Needs work";
  const repColor =
    reviews.totalReviews === 0 ? "bg-stone-300" :
    avg >= 4.0                  ? "bg-emerald-500" :
    avg >= 3.5                  ? "bg-amber-400"   :
    "bg-red-500";
  const repText =
    reviews.totalReviews === 0 ? "text-stone-400" :
    avg >= 4.0                  ? "text-emerald-700" :
    avg >= 3.5                  ? "text-amber-600"   :
    "text-red-600";

  return [
    {
      label: "Compliance",
      pct:    compPct,
      value:  compliance.total > 0 ? `${compPct}%` : "—",
      status: compStatus,
      color:  compColor,
      textClr: compText,
    },
    {
      label: "Maintenance",
      pct:    Math.max(0, maintPct),
      value:  totalEquip > 0 ? `${Math.max(0, maintPct)}%` : "—",
      status: maintStatus,
      color:  maintColor,
      textClr: maintText,
    },
    {
      label: "Revenue",
      pct:    revPct,
      value:  forecast ? `${revPct}%` : "—",
      status: revStatus,
      color:  revColor,
      textClr: revText,
    },
    {
      label: "Reputation",
      pct:    repPct,
      value:  reviews.totalReviews > 0 ? `${avg.toFixed(1)} ★` : "—",
      status: repStatus,
      color:  repColor,
      textClr: repText,
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperationalHealth({
  compliance,
  maintenance,
  forecast,
  reviews,
}: Props) {
  const bars = buildBars(compliance, maintenance, forecast, reviews);

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-stone-100">
        <h2 className="text-xs font-semibold text-stone-700">Operational Health</h2>
      </div>

      {/* Bars */}
      <div className="flex-1 divide-y divide-stone-100">
        {bars.map((bar) => (
          <div key={bar.label} className="px-5 py-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-stone-600">{bar.label}</span>
              <div className="flex items-center gap-2">
                <span className={cn("text-[11px] font-medium", bar.textClr)}>
                  {bar.status}
                </span>
                <span className={cn("text-[11px] font-bold tabular-nums", bar.textClr)}>
                  {bar.value}
                </span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
              <div
                className={cn("h-1.5 rounded-full transition-all duration-500", bar.color)}
                style={{ width: `${bar.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
