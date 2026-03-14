/**
 * Revenue Intelligence Engine — forecast service
 *
 * Deterministic, weighted signal forecast for daily revenue, covers,
 * and average spend. Provides confidence scoring, risk analysis, and
 * actionable recommendations.
 *
 * All dates are handled as YYYY-MM-DD strings.
 * Timezone-safe: uses noon-UTC anchoring for date arithmetic.
 */

import { createServerClient } from "@/lib/supabase/server";
import { toNum } from "@/lib/utils";
import {
  RevenueForecast,
  ForecastFactors,
  ForecastRecommendation,
  SalesTarget,
} from "@/types";
import {
  DEFAULT_ORG_ID,
  EVENT_REVENUE_MULTIPLIERS,
  DEFAULT_EVENT_MULTIPLIER,
  DEFAULT_AVG_SPEND_ZAR,
  WALKIN_COVER_RATIO,
  RISK,
  QUIZ_NIGHT_ANCHOR,
  QUIZ_NIGHT_INTERVAL_DAYS,
  SALSA_NIGHT_ANCHOR,
  SALSA_NIGHT_INTERVAL_DAYS,
} from "@/lib/constants";

// ── Date helpers ───────────────────────────────────────────────────────────────

/**
 * Return the last N same-weekday dates before dateStr, stepping back
 * exactly 7 days each time so every result has the same day-of-week.
 */
function lastNSameWeekdays(dateStr: string, n = 8): string[] {
  const dates: string[] = [];
  // noon UTC avoids any DST crossing during date-only arithmetic
  const d = new Date(dateStr + "T12:00:00Z");
  for (let i = 0; i < n; i++) {
    d.setUTCDate(d.getUTCDate() - 7);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Return the same calendar date exactly one year before dateStr. */
function sameDayLastYear(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Signal fetchers ────────────────────────────────────────────────────────────

export async function getSameDayLastYearSales(dateStr: string): Promise<number | null> {
  const supabase = createServerClient();
  const lastYear = sameDayLastYear(dateStr);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("historical_sales") as any)
    .select("gross_sales")
    .eq("sale_date", lastYear)
    .maybeSingle();

  const v = toNum(data?.gross_sales);
  return v != null && v > 0 ? v : null;
}

export async function getRecentWeekdayAverageSales(
  dateStr: string,
  n = 8
): Promise<number | null> {
  const supabase = createServerClient();
  const dates = lastNSameWeekdays(dateStr, n);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("historical_sales") as any)
    .select("gross_sales")
    .in("sale_date", dates);

  if (!data || data.length === 0) return null;
  const vals = (data as { gross_sales: unknown }[])
    .map((r) => toNum(r.gross_sales))
    .filter((v): v is number => v != null && v > 0);

  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export async function getSameDayLastYearCovers(dateStr: string): Promise<number | null> {
  const supabase = createServerClient();
  const lastYear = sameDayLastYear(dateStr);

  const { data } = await supabase
    .from("daily_operations_reports")
    .select("guest_count")
    .eq("report_date", lastYear)
    .maybeSingle();

  const v = toNum((data as { guest_count?: unknown } | null)?.guest_count);
  return v != null && v > 0 ? v : null;
}

export async function getRecentWeekdayAverageCovers(
  dateStr: string,
  n = 8
): Promise<number | null> {
  const supabase = createServerClient();
  const dates = lastNSameWeekdays(dateStr, n);

  const { data } = await supabase
    .from("daily_operations_reports")
    .select("guest_count")
    .in("report_date", dates);

  if (!data || data.length === 0) return null;
  const vals = (data as { guest_count?: unknown }[])
    .map((r) => toNum(r.guest_count))
    .filter((v): v is number => v != null && v > 0);

  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export async function getConfirmedCoversForDate(dateStr: string): Promise<number> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("reservations")
    .select("guest_count")
    .eq("booking_date", dateStr)
    .neq("status", "cancelled");

  if (!data || data.length === 0) return 0;
  return data.reduce((s, r) => s + (Number(r.guest_count) || 0), 0);
}

export async function getHistoricalAvgSpendPerGuest(
  dateStr: string,
  n = 8
): Promise<number | null> {
  const supabase = createServerClient();
  const dates = lastNSameWeekdays(dateStr, n);

  const { data } = await supabase
    .from("daily_operations_reports")
    .select("guests_average_spend")
    .in("report_date", dates);

  if (!data || data.length === 0) return null;
  const vals = (data as { guests_average_spend?: unknown }[])
    .map((r) => toNum(r.guests_average_spend))
    .filter((v): v is number => v != null && v > 0);

  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export async function getEventMultiplierForDate(
  dateStr: string
): Promise<{ multiplier: number; eventName: string | null }> {
  const supabase = createServerClient();

  // 1. Check the events table for non-cancelled events on this date
  const { data: dbEvents } = await supabase
    .from("events")
    .select("name, cancelled")
    .eq("event_date", dateStr)
    .eq("cancelled", false);

  if (dbEvents && dbEvents.length > 0) {
    for (const event of dbEvents as { name: string; cancelled: boolean }[]) {
      const multiplier = EVENT_REVENUE_MULTIPLIERS[event.name];
      if (multiplier != null) {
        return { multiplier, eventName: event.name };
      }
    }
    // Event found but no specific multiplier — still flag the event name
    return {
      multiplier: DEFAULT_EVENT_MULTIPLIER,
      eventName: (dbEvents[0] as { name: string }).name,
    };
  }

  // 2. Fall back to computed recurring events (Quiz Night / Salsa Night)
  const d = new Date(dateStr + "T12:00:00Z");
  if (d.getUTCDay() === 5 /* Friday */) {
    const quizAnchor = new Date(QUIZ_NIGHT_ANCHOR + "T12:00:00Z");
    const quizDiff = Math.round(
      (d.getTime() - quizAnchor.getTime()) / 86_400_000
    );
    if (quizDiff >= 0 && quizDiff % QUIZ_NIGHT_INTERVAL_DAYS === 0) {
      return {
        multiplier: EVENT_REVENUE_MULTIPLIERS["Quiz Night"] ?? 1.15,
        eventName: "Quiz Night",
      };
    }

    const salsaAnchor = new Date(SALSA_NIGHT_ANCHOR + "T12:00:00Z");
    const salsaDiff = Math.round(
      (d.getTime() - salsaAnchor.getTime()) / 86_400_000
    );
    if (salsaDiff >= 0 && salsaDiff % SALSA_NIGHT_INTERVAL_DAYS === 0) {
      return {
        multiplier: EVENT_REVENUE_MULTIPLIERS["Salsa Night"] ?? 1.20,
        eventName: "Salsa Night",
      };
    }
  }

  return { multiplier: DEFAULT_EVENT_MULTIPLIER, eventName: null };
}

export async function getSalesTarget(dateStr: string): Promise<SalesTarget | null> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("sales_targets") as any)
    .select("*")
    .eq("organization_id", DEFAULT_ORG_ID)
    .eq("target_date", dateStr)
    .maybeSingle();

  return data ? (data as SalesTarget) : null;
}

// ── Walk-in estimation ─────────────────────────────────────────────────────────

function estimateWalkInCovers(
  confirmedCovers: number,
  recentAvgCovers: number | null
): number {
  if (recentAvgCovers != null && recentAvgCovers > confirmedCovers) {
    // Expect WALKIN_COVER_RATIO of the unbooked average to materialise as walk-ins
    return Math.max(0, Math.round((recentAvgCovers - confirmedCovers) * WALKIN_COVER_RATIO));
  }
  // No historical cover data: assume 20 % walk-in premium over confirmed bookings
  return Math.round(confirmedCovers * 0.2);
}

// ── Forecast builder ───────────────────────────────────────────────────────────

function buildForecastSales(params: {
  lastYearSales:          number | null;
  recentWeekdayAvgSales:  number | null;
  confirmedCovers:        number;
  walkInCovers:           number;
  avgSpend:               number;
  eventMultiplier:        number;
}): { forecastSales: number; signalCount: number } {
  const signals: Array<{ value: number; weight: number }> = [];

  if (params.lastYearSales != null && params.lastYearSales > 0)
    signals.push({ value: params.lastYearSales,                              weight: 30 });

  if (params.recentWeekdayAvgSales != null && params.recentWeekdayAvgSales > 0)
    signals.push({ value: params.recentWeekdayAvgSales,                      weight: 25 });

  if (params.confirmedCovers > 0)
    signals.push({ value: params.confirmedCovers * params.avgSpend,          weight: 20 });

  if (params.walkInCovers > 0)
    signals.push({ value: params.walkInCovers * params.avgSpend,             weight: 15 });

  if (signals.length === 0) {
    // Absolute zero historical data — pure covers × spend estimate
    const total = params.confirmedCovers + params.walkInCovers;
    return {
      forecastSales: Math.round(total * params.avgSpend * params.eventMultiplier),
      signalCount: 0,
    };
  }

  // Normalise weights so they sum to 1.0, then apply event multiplier
  const totalW = signals.reduce((s, sig) => s + sig.weight, 0);
  const base   = signals.reduce((s, sig) => s + (sig.value * sig.weight) / totalW, 0);

  return {
    forecastSales: Math.round(base * params.eventMultiplier),
    signalCount:   signals.length,
  };
}

// ── Confidence ─────────────────────────────────────────────────────────────────

function computeConfidence(
  lastYearSales:  number | null,
  recentWeekdaySales: number | null,
  hasBookings:    boolean
): "low" | "medium" | "high" {
  const count =
    (lastYearSales != null ? 1 : 0) +
    (recentWeekdaySales != null ? 1 : 0) +
    (hasBookings ? 1 : 0);
  if (count >= 3) return "high";
  if (count >= 2) return "medium";
  return "low";
}

// ── Risk analysis ──────────────────────────────────────────────────────────────

function computeRisk(params: {
  laborPct:          number | null;
  marginPct:         number | null;
  salesGap:          number | null;
  targetSales:       number | null;
  outOfServiceCount: number;
  eventName:         string | null;
  confirmedCovers:   number;
  recentAvgCovers:   number | null;
}): { riskLevel: "low" | "medium" | "high"; riskReasons: string[] } {
  const reasons: string[] = [];
  let level = 0; // 0=low 1=medium 2=high

  const bump = (l: number) => { if (l > level) level = l; };

  // Labor
  if (params.laborPct != null) {
    if (params.laborPct > RISK.LABOR_HIGH_PCT) {
      reasons.push(`Labor cost is ${params.laborPct.toFixed(1)}% — above the ${RISK.LABOR_HIGH_PCT}% threshold`);
      bump(2);
    } else if (params.laborPct > RISK.LABOR_MEDIUM_PCT) {
      reasons.push(`Labor cost is ${params.laborPct.toFixed(1)}% (elevated, above ${RISK.LABOR_MEDIUM_PCT}%)`);
      bump(1);
    }
  }

  // Margin
  if (params.marginPct != null) {
    if (params.marginPct < RISK.MARGIN_LOW_PCT) {
      reasons.push(`Gross margin is ${params.marginPct.toFixed(1)}% — critically below ${RISK.MARGIN_LOW_PCT}%`);
      bump(2);
    } else if (params.marginPct < RISK.MARGIN_MEDIUM_PCT) {
      reasons.push(`Gross margin is ${params.marginPct.toFixed(1)}% — below ${RISK.MARGIN_MEDIUM_PCT}%`);
      bump(1);
    }
  }

  // Sales gap vs target
  if (params.salesGap != null && params.targetSales && params.targetSales > 0) {
    const gapPct = (params.salesGap / params.targetSales) * 100;
    if (gapPct < RISK.SALES_GAP_HIGH_PCT) {
      reasons.push(`Forecast is ${Math.abs(gapPct).toFixed(1)}% below today's sales target`);
      bump(2);
    } else if (gapPct < RISK.SALES_GAP_MEDIUM_PCT) {
      reasons.push(`Forecast is ${Math.abs(gapPct).toFixed(1)}% below today's sales target`);
      bump(1);
    }
  }

  // Out-of-service equipment
  if (params.outOfServiceCount > 0) {
    const n = params.outOfServiceCount;
    reasons.push(`${n} equipment unit${n > 1 ? "s are" : " is"} out of service`);
    bump(2);
  }

  // Event fill rate — under-booked relative to typical average
  if (
    params.eventName &&
    params.recentAvgCovers != null &&
    params.recentAvgCovers > 0 &&
    params.confirmedCovers / params.recentAvgCovers < RISK.EVENT_LOW_FILL_RATIO
  ) {
    const fillPct = Math.round((params.confirmedCovers / params.recentAvgCovers) * 100);
    reasons.push(
      `"${params.eventName}" bookings are at ${fillPct}% of the typical average`
    );
    bump(2);
  }

  const levels = ["low", "medium", "high"] as const;
  return { riskLevel: levels[level], riskReasons: reasons };
}

// ── Recommendation engine ──────────────────────────────────────────────────────

export function generateForecastRecommendations(
  forecast: RevenueForecast
): ForecastRecommendation[] {
  const recs: ForecastRecommendation[] = [];
  const f = forecast.factors;

  // 1. Gap-closure covers
  if (forecast.sales_gap != null && forecast.sales_gap < 0 && forecast.required_extra_covers > 0) {
    const n = forecast.required_extra_covers;
    recs.push({
      title:       "Close the revenue gap",
      description: `You need approximately ${n} more cover${n === 1 ? "" : "s"} at the current average spend to reach today's sales target. Focus on walk-in conversion and confirming any pending bookings.`,
      priority:    n > 12 ? "high" : "medium",
    });
  }

  // 2. Labor
  if (f.latest_labor_pct != null && f.latest_labor_pct > RISK.LABOR_HIGH_PCT) {
    recs.push({
      title:       "Review staffing before service",
      description: `Labor is running at ${f.latest_labor_pct.toFixed(1)}% of revenue — above the ${RISK.LABOR_HIGH_PCT}% threshold. Review tonight's roster against the forecast cover count before service begins.`,
      priority:    "high",
    });
  } else if (f.latest_labor_pct != null && f.latest_labor_pct > RISK.LABOR_MEDIUM_PCT) {
    recs.push({
      title:       "Monitor labor costs during service",
      description: `Labor is at ${f.latest_labor_pct.toFixed(1)}%. Track hours against cover count during service to avoid unnecessary overtime.`,
      priority:    "medium",
    });
  }

  // 3. Under-booked event
  if (
    f.event_name &&
    f.recent_weekday_avg_covers != null &&
    f.recent_weekday_avg_covers > 0 &&
    f.confirmed_covers / f.recent_weekday_avg_covers < RISK.EVENT_LOW_FILL_RATIO
  ) {
    recs.push({
      title:       `Push bookings for "${f.event_name}"`,
      description: `Tonight's event has low confirmed covers relative to the typical weekday average. Push WhatsApp and Instagram promotions before 4 pm to drive last-minute interest.`,
      priority:    "high",
    });
  }

  // 4. Spend uplift opportunity
  if (f.historical_avg_spend != null && forecast.forecast_avg_spend < f.historical_avg_spend * 0.90) {
    recs.push({
      title:       "Drive spend per cover",
      description: `Forecast average spend is below the historical weekday average. Activate floor staff to recommend high-margin cocktails, wine pairings, and sharing plates to lift revenue per guest.`,
      priority:    "medium",
    });
  } else if (f.historical_avg_spend == null && forecast.forecast_avg_spend < DEFAULT_AVG_SPEND_ZAR * 0.85) {
    recs.push({
      title:       "Drive spend per cover",
      description: `Average spend forecast is below typical. Promote high-margin cocktails and sharing plates at table to lift total revenue.`,
      priority:    "medium",
    });
  }

  // 5. Margin under pressure
  if (f.latest_margin_pct != null && f.latest_margin_pct < RISK.MARGIN_LOW_PCT) {
    recs.push({
      title:       "Protect margin — avoid discounting",
      description: `Margin is at ${f.latest_margin_pct.toFixed(1)}% — critically low. Avoid discount-heavy selling and push the kitchen's profitable menu items tonight.`,
      priority:    "high",
    });
  }

  // 6. Out of service equipment
  if (f.out_of_service_count > 0) {
    const n = f.out_of_service_count;
    recs.push({
      title:       "Confirm service capacity",
      description: `${n} equipment unit${n > 1 ? "s are" : " is"} currently out of service. Confirm with the kitchen and bar that tonight's menu and service can run at full capacity.`,
      priority:    "high",
    });
  }

  // Sort: high → medium → low
  const order: Record<ForecastRecommendation["priority"], number> = {
    high: 0, medium: 1, low: 2,
  };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}

// ── Main generator ─────────────────────────────────────────────────────────────

export async function generateRevenueForecast(
  dateStr: string
): Promise<RevenueForecast> {
  const supabase = createServerClient();

  // Fetch all signals in parallel — individual failures return null gracefully
  const [
    lastYearSales,
    recentWeekdaySales,
    recentAvgCovers,
    confirmedCovers,
    histAvgSpend,
    eventInfo,
    target,
    latestOpsResult,
    outOfServiceResult,
  ] = await Promise.all([
    getSameDayLastYearSales(dateStr),
    getRecentWeekdayAverageSales(dateStr),
    getRecentWeekdayAverageCovers(dateStr),
    getConfirmedCoversForDate(dateStr),
    getHistoricalAvgSpendPerGuest(dateStr),
    getEventMultiplierForDate(dateStr),
    getSalesTarget(dateStr),
    supabase
      .from("daily_operations_reports")
      .select("labor_cost_percent, margin_percent")
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("equipment")
      .select("id")
      .eq("status", "out_of_service"),
  ]);

  const latestOps       = latestOpsResult.data as { labor_cost_percent?: unknown; margin_percent?: unknown } | null;
  const outOfServiceCount = (outOfServiceResult.data ?? []).length;
  const laborPct          = toNum(latestOps?.labor_cost_percent);
  const marginPct         = toNum(latestOps?.margin_percent);

  // Resolve avg spend with DEFAULT fallback
  const resolvedAvgSpend = histAvgSpend ?? DEFAULT_AVG_SPEND_ZAR;

  // Walk-in estimate
  const walkInCovers = estimateWalkInCovers(confirmedCovers, recentAvgCovers);

  // Forecast sales
  const { forecastSales, signalCount } = buildForecastSales({
    lastYearSales:         lastYearSales,
    recentWeekdayAvgSales: recentWeekdaySales,
    confirmedCovers,
    walkInCovers,
    avgSpend:              resolvedAvgSpend,
    eventMultiplier:       eventInfo.multiplier,
  });

  const forecastCovers   = confirmedCovers + walkInCovers;
  const forecastAvgSpend =
    forecastCovers > 0
      ? Math.round((forecastSales / forecastCovers) * 100) / 100
      : resolvedAvgSpend;

  // Gap analysis
  const targetSales  = toNum(target?.target_sales);
  const targetCovers = toNum(target?.target_covers);

  const salesGap    = targetSales != null ? forecastSales - targetSales : null;
  const salesGapPct =
    salesGap != null && targetSales !== null && targetSales > 0
      ? Math.round((salesGap / targetSales) * 1000) / 10   // 1 dp
      : null;
  const coversGap   = targetCovers != null ? forecastCovers - targetCovers : null;

  const requiredExtraCovers =
    targetSales != null && forecastAvgSpend > 0
      ? Math.max(0, Math.ceil((targetSales - forecastSales) / forecastAvgSpend))
      : 0;

  // Confidence
  const confidence = computeConfidence(lastYearSales, recentWeekdaySales, confirmedCovers > 0);

  // Risk
  const { riskLevel, riskReasons } = computeRisk({
    laborPct,
    marginPct,
    salesGap,
    targetSales,
    outOfServiceCount,
    eventName:       eventInfo.eventName,
    confirmedCovers,
    recentAvgCovers,
  });

  const factors: ForecastFactors = {
    same_day_last_year_sales:  lastYearSales,
    recent_weekday_avg_sales:  recentWeekdaySales,
    recent_weekday_avg_covers: recentAvgCovers,
    confirmed_covers:          confirmedCovers,
    expected_walk_in_covers:   walkInCovers,
    historical_avg_spend:      histAvgSpend,
    event_name:                eventInfo.eventName,
    event_multiplier:          eventInfo.multiplier,
    signal_count:              signalCount,
    latest_labor_pct:          laborPct,
    latest_margin_pct:         marginPct,
    out_of_service_count:      outOfServiceCount,
  };

  const partial: RevenueForecast = {
    date:                  dateStr,
    forecast_sales:        forecastSales,
    forecast_covers:       forecastCovers,
    forecast_avg_spend:    forecastAvgSpend,
    target_sales:          targetSales,
    target_covers:         targetCovers,
    sales_gap:             salesGap,
    sales_gap_pct:         salesGapPct,
    covers_gap:            coversGap,
    required_extra_covers: requiredExtraCovers,
    confidence,
    risk_level:            riskLevel,
    risk_reasons:          riskReasons,
    factors,
    recommendations:       [],
  };

  partial.recommendations = generateForecastRecommendations(partial);
  return partial;
}

// ── Snapshot persistence (for cron / audit trail) ──────────────────────────────

export async function saveForecastSnapshot(dateStr: string): Promise<void> {
  const forecast = await generateRevenueForecast(dateStr);
  const supabase = createServerClient();

  const payload = {
    organization_id:      DEFAULT_ORG_ID,
    forecast_date:        forecast.date,
    forecast_sales:       forecast.forecast_sales,
    forecast_covers:      forecast.forecast_covers,
    forecast_avg_spend:   forecast.forecast_avg_spend,
    target_sales:         forecast.target_sales,
    target_covers:        forecast.target_covers,
    sales_gap:            forecast.sales_gap,
    covers_gap:           forecast.covers_gap,
    confidence:           forecast.confidence,
    risk_level:           forecast.risk_level,
    factors_json:         forecast.factors          as unknown as Record<string, unknown>,
    recommendations_json: forecast.recommendations  as unknown as Record<string, unknown>[],
    updated_at:           new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("forecast_snapshots") as any)
    .upsert(payload, { onConflict: "organization_id,forecast_date" });
}

// ── Upcoming targets (for targets settings page) ───────────────────────────────

export async function getUpcomingTargets(days = 30): Promise<SalesTarget[]> {
  const supabase = createServerClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const future = new Date(today + "T12:00:00Z");
  future.setUTCDate(future.getUTCDate() + days);
  const futureStr = future.toISOString().slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("sales_targets") as any)
    .select("*")
    .eq("organization_id", DEFAULT_ORG_ID)
    .gte("target_date", today)
    .lte("target_date", futureStr)
    .order("target_date", { ascending: true });

  return (data ?? []) as SalesTarget[];
}
