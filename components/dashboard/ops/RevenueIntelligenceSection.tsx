/**
 * Revenue Intelligence Section — hero dashboard component.
 *
 * Displays forecast sales, covers, avg spend, target gap, risk level,
 * confidence, input signals, and recommended actions.
 *
 * Server component — receives pre-fetched RevenueForecast as props.
 */

import Link from "next/link";
import { RevenueForecast, ForecastRecommendation } from "@/types";
import { formatCurrency, formatShortDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  forecast: RevenueForecast | null;
  date: string;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RevenueIntelligenceSection({ forecast, date }: Props) {
  // ── Error / null state ──
  if (!forecast) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <SectionHeader date={date} />
        <p className="mt-4 text-sm text-stone-400">
          Unable to compute forecast — check service configuration.
        </p>
      </section>
    );
  }

  // ── No-data state ──
  const hasNoData =
    forecast.factors.signal_count === 0 && forecast.forecast_covers === 0;

  if (hasNoData) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <SectionHeader date={date} />
        <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-stone-600">
            No forecasting data available yet
          </p>
          <p className="mt-1 text-xs text-stone-400 max-w-sm mx-auto">
            Upload historical daily sales to enable
            revenue forecasting and recommendations.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs">
            <Link
              href="/dashboard/sales/historical"
              className="text-stone-600 underline hover:text-stone-900"
            >
              Upload historical sales →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const {
    forecast_sales,
    forecast_covers,
    forecast_avg_spend,
    sales_gap,
    sales_gap_pct,
    covers_gap,
    required_extra_covers,
    confidence,
    risk_level,
    risk_reasons,
    factors,
    recommendations,
    target_sales,
    target_covers,
  } = forecast;

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">

      {/* ── Header row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <SectionHeader date={date} />
        <div className="flex flex-wrap items-center gap-2">
          {factors.event_name && (
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
              🎭 {factors.event_name}
            </span>
          )}
          <ConfidenceBadge level={confidence} />
          <RiskBadge level={risk_level} />
          <Link
            href="/dashboard/settings/targets"
            className="text-xs text-stone-400 underline hover:text-stone-700"
          >
            Targets ↗
          </Link>
        </div>
      </div>

      {/* ── Primary metrics ── */}
      <div className="grid grid-cols-2 gap-px bg-stone-100 sm:grid-cols-4">
        <MetricCell
          label="Forecast Sales"
          value={formatCurrency(forecast_sales)}
          sub={
            factors.event_multiplier > 1
              ? `×${factors.event_multiplier.toFixed(2)} event lift`
              : undefined
          }
        />
        <MetricCell
          label="Forecast Covers"
          value={String(forecast_covers)}
          sub={`${factors.confirmed_covers} confirmed · ${factors.expected_walk_in_covers} walk-in est.`}
        />
        <MetricCell
          label="Avg Spend / Cover"
          value={formatCurrency(forecast_avg_spend)}
          sub={
            factors.historical_avg_spend != null
              ? `hist. avg ${formatCurrency(factors.historical_avg_spend)}`
              : "based on default"
          }
        />
        {sales_gap != null ? (
          <MetricCell
            label="vs Target"
            value={`${sales_gap >= 0 ? "+" : ""}${formatCurrency(sales_gap)}`}
            sub={
              sales_gap_pct != null
                ? `${sales_gap_pct >= 0 ? "+" : ""}${sales_gap_pct.toFixed(1)}% vs ${formatCurrency(target_sales)}`
                : null
            }
            highlight={sales_gap < 0}
            positive={sales_gap >= 0}
          />
        ) : (
          <MetricCell
            label="vs Target"
            value="No target set"
            sub={
              <Link
                href="/dashboard/settings/targets"
                className="text-[10px] text-stone-400 underline hover:text-stone-600"
              >
                Set a target →
              </Link>
            }
          />
        )}
      </div>

      {/* ── Signal row ── */}
      <div className="grid grid-cols-3 gap-px bg-stone-100">
        <SignalCell
          label="Same day last year"
          value={
            factors.same_day_last_year_sales != null
              ? formatCurrency(factors.same_day_last_year_sales)
              : "No data"
          }
          available={factors.same_day_last_year_sales != null}
        />
        <SignalCell
          label="Recent weekday avg"
          value={
            factors.recent_weekday_avg_sales != null
              ? formatCurrency(factors.recent_weekday_avg_sales)
              : "No data"
          }
          available={factors.recent_weekday_avg_sales != null}
        />
        <SignalCell
          label="Historical avg covers"
          value={
            factors.recent_weekday_avg_covers != null
              ? `${Math.round(factors.recent_weekday_avg_covers)} covers`
              : "No data"
          }
          available={factors.recent_weekday_avg_covers != null}
        />
      </div>

      {/* ── Target gap callout ── */}
      {target_sales != null && required_extra_covers > 0 && (
        <div className="mx-5 my-4 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-amber-800">Revenue gap</p>
            <p className="mt-0.5 text-xs text-amber-700">
              Need{" "}
              <strong>
                {required_extra_covers} more cover
                {required_extra_covers === 1 ? "" : "s"}
              </strong>{" "}
              at current avg spend ({formatCurrency(forecast_avg_spend)}) to hit
              the {formatCurrency(target_sales)} target
            </p>
          </div>
          {covers_gap != null && (
            <div className="shrink-0 text-right">
              <p className="text-[10px] text-amber-500">Covers gap</p>
              <p className="text-sm font-bold text-amber-800">
                {covers_gap >= 0 ? "+" : ""}
                {Math.round(covers_gap)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Risk factors ── */}
      {risk_reasons.length > 0 && (
        <div className="mx-5 mb-2">
          <details open={risk_level === "high"}>
            <summary className="cursor-pointer select-none text-xs font-medium text-stone-500 hover:text-stone-800">
              {risk_reasons.length} risk factor
              {risk_reasons.length > 1 ? "s" : ""} flagged
            </summary>
            <ul className="mt-2 space-y-1 pb-1">
              {risk_reasons.map((r, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-stone-600"
                >
                  <span className="mt-0.5 shrink-0 text-red-400">•</span>
                  {r}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* ── Recommended actions ── */}
      {recommendations.length > 0 && (
        <div className="border-t border-stone-100 px-5 py-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-stone-400">
            {recommendations.length} Recommended Action
            {recommendations.length > 1 ? "s" : ""}
          </p>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base leading-none">⚡</span>
      <div>
        <h2 className="text-sm font-bold text-stone-900">Revenue Intelligence</h2>
        <p className="text-[10px] text-stone-400">{formatShortDate(date)} forecast</p>
      </div>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "low" | "medium" | "high" }) {
  const cls = {
    high:   "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    low:    "bg-stone-100 text-stone-500",
  }[level];
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>
      {level} confidence
    </span>
  );
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const cls = {
    high:   "bg-red-100 text-red-700 border border-red-200",
    medium: "bg-orange-100 text-orange-700 border border-orange-200",
    low:    "bg-green-100 text-green-700 border border-green-200",
  }[level];
  const label = { high: "⚠ High Risk", medium: "⚠ Medium Risk", low: "✓ Low Risk" }[level];
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold", cls)}>
      {label}
    </span>
  );
}

function MetricCell({
  label,
  value,
  sub,
  highlight,
  positive,
}: {
  label:     string;
  value:     string;
  sub?:      React.ReactNode;
  highlight?: boolean;
  positive?:  boolean;
}) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold leading-tight sm:text-xl",
          highlight  ? "text-red-600"
          : positive  ? "text-green-600"
          : "text-stone-900"
        )}
      >
        {value}
      </p>
      {sub != null && (
        <p className="mt-0.5 text-[10px] text-stone-400 leading-snug">{sub}</p>
      )}
    </div>
  );
}

function SignalCell({
  label,
  value,
  available,
}: {
  label:     string;
  value:     string;
  available: boolean;
}) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="text-[9px] font-medium uppercase tracking-wide text-stone-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xs font-semibold",
          available ? "text-stone-700" : "text-stone-300"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: ForecastRecommendation }) {
  const cardCls = {
    high:   "border-red-200 bg-red-50",
    medium: "border-amber-200 bg-amber-50",
    low:    "border-stone-200 bg-stone-50",
  }[rec.priority];

  const labelCls = {
    high:   "text-red-600",
    medium: "text-amber-600",
    low:    "text-stone-500",
  }[rec.priority];

  const labelText = { high: "URGENT", medium: "ACTION", low: "NOTE" }[rec.priority];

  return (
    <div className={cn("rounded-lg border px-4 py-3", cardCls)}>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-none",
            labelCls
          )}
        >
          {labelText}
        </span>
        <div>
          <p className="text-xs font-semibold text-stone-800">{rec.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-stone-600">
            {rec.description}
          </p>
        </div>
      </div>
    </div>
  );
}
