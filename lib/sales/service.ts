/**
 * lib/sales/service.ts — Unified sales data service
 *
 * getCurrentSalesSnapshot() is the SINGLE ENTRY POINT for all
 * revenue-dependent UI. It resolves data from three sources in
 * priority order:
 *
 *   1. MICROS live POS data (if fresh)
 *   2. Manual daily sales upload (if exists for today)
 *   3. Revenue forecast (always available as fallback)
 *
 * Returns a NormalizedSalesSnapshot that every widget reads.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { MicrosStatusSummary, MicrosSalesDaily } from "@/types/micros";
import type { RevenueForecast } from "@/types";
import type { NormalizedSalesSnapshot, SalesDataSource } from "./types";
import {
  classifyFreshness,
  freshnessSourceLabel,
} from "./freshness";

// ── Manual upload row shape ─────────────────────────────────────────────────

interface ManualSalesRow {
  id: string;
  business_date: string;
  gross_sales: number;
  net_sales: number | null;
  covers: number;
  checks: number;
  avg_spend_per_cover: number | null;
  avg_check_value: number | null;
  labour_percent: number | null;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

// ── Build from MICROS ───────────────────────────────────────────────────────

function buildFromMicros(
  daily: MicrosSalesDaily,
  minutesSinceSync: number | null,
  forecast: RevenueForecast | null,
  bookingsToday: number | null,
  bookedCoversToday: number | null,
): NormalizedSalesSnapshot {
  const freshness = classifyFreshness(minutesSinceSync);
  const netSales = daily.net_sales;
  const grossSales = daily.gross_sales;
  const covers = daily.guest_count;
  const checks = daily.check_count;
  const avgSpend = covers > 0 ? netSales / covers : 0;
  const avgCheck = checks > 0 ? netSales / checks : 0;

  const targetSales = forecast?.target_sales ?? null;
  const sameDayLY = forecast?.last_year_sales ?? null;
  const targetSource = forecast?.target_source ?? null;
  const variance = targetSales != null ? netSales - targetSales : null;
  const variancePct = targetSales != null && targetSales > 0
    ? Math.round(((netSales - targetSales) / targetSales) * 1000) / 10
    : null;
  const progressPct = targetSales != null && targetSales > 0
    ? Math.min(100, Math.round((netSales / targetSales) * 100))
    : null;
  const walkInRecovery = variance != null && variance < 0 ? Math.abs(variance) : null;
  const additionalCovers = walkInRecovery != null && avgSpend > 0
    ? Math.ceil(walkInRecovery / avgSpend)
    : null;

  return {
    source: "micros",
    sourceLabel: freshnessSourceLabel("micros", freshness),
    isLive: freshness === "live",
    isStale: freshness === "stale",
    freshnessState: freshness,
    freshnessMinutes: minutesSinceSync,
    lastUpdatedAt: daily.synced_at ?? null,
    businessDate: daily.business_date,
    netSales: round2(netSales),
    grossSales: round2(grossSales),
    covers,
    checks,
    averageSpendPerCover: round2(avgSpend),
    averageCheckValue: round2(avgCheck),
    labourCostPercent: daily.labor_pct > 0 ? daily.labor_pct : null,
    labourCostAmount: daily.labor_cost > 0 ? daily.labor_cost : null,
    targetSales,
    sameDayLastYearSales: sameDayLY,
    targetSource,
    targetVarianceAmount: variance,
    targetVariancePercent: variancePct,
    forecastProgressPercent: progressPct,
    walkInRecoveryNeeded: walkInRecovery,
    additionalCoversNeeded: additionalCovers,
    bookingsToday,
    bookedCoversToday,
    notes: [],
  };
}

// ── Build from manual upload ────────────────────────────────────────────────

function buildFromManual(
  row: ManualSalesRow,
  forecast: RevenueForecast | null,
  bookingsToday: number | null,
  bookedCoversToday: number | null,
): NormalizedSalesSnapshot {
  const uploadedMinutesAgo = Math.floor(
    (Date.now() - new Date(row.uploaded_at).getTime()) / 60_000,
  );
  const freshness = classifyFreshness(uploadedMinutesAgo);
  const netSales = row.net_sales ?? row.gross_sales;
  const grossSales = row.gross_sales;
  const covers = row.covers;
  const checks = row.checks;
  const avgSpend = row.avg_spend_per_cover ?? (covers > 0 ? netSales / covers : 0);
  const avgCheck = row.avg_check_value ?? (checks > 0 ? netSales / checks : 0);

  const targetSales = forecast?.target_sales ?? null;
  const sameDayLY = forecast?.last_year_sales ?? null;
  const targetSource = forecast?.target_source ?? null;
  const variance = targetSales != null ? netSales - targetSales : null;
  const variancePct = targetSales != null && targetSales > 0
    ? Math.round(((netSales - targetSales) / targetSales) * 1000) / 10
    : null;
  const progressPct = targetSales != null && targetSales > 0
    ? Math.min(100, Math.round((netSales / targetSales) * 100))
    : null;
  const walkInRecovery = variance != null && variance < 0 ? Math.abs(variance) : null;
  const additionalCovers = walkInRecovery != null && avgSpend > 0
    ? Math.ceil(walkInRecovery / avgSpend)
    : null;

  const notes: string[] = [];
  if (row.notes) notes.push(row.notes);
  if (row.uploaded_by) notes.push(`Uploaded by ${row.uploaded_by}`);

  return {
    source: "manual",
    sourceLabel: freshnessSourceLabel("manual", freshness),
    isLive: false,
    isStale: false,
    freshnessState: freshness,
    freshnessMinutes: uploadedMinutesAgo,
    lastUpdatedAt: row.uploaded_at,
    businessDate: row.business_date,
    netSales: round2(netSales),
    grossSales: round2(grossSales),
    covers,
    checks,
    averageSpendPerCover: round2(avgSpend),
    averageCheckValue: round2(avgCheck),
    labourCostPercent: row.labour_percent,
    labourCostAmount: null,
    targetSales,
    sameDayLastYearSales: sameDayLY,
    targetSource,
    targetVarianceAmount: variance,
    targetVariancePercent: variancePct,
    forecastProgressPercent: progressPct,
    walkInRecoveryNeeded: walkInRecovery,
    additionalCoversNeeded: additionalCovers,
    bookingsToday,
    bookedCoversToday,
    notes,
  };
}

// ── Build from forecast (ultimate fallback) ─────────────────────────────────

function buildFromForecast(
  forecast: RevenueForecast,
  bookingsToday: number | null,
  bookedCoversToday: number | null,
): NormalizedSalesSnapshot {
  const { forecast_sales, forecast_covers, forecast_avg_spend, target_sales, target_source, last_year_sales, sales_gap, sales_gap_pct, required_extra_covers, confidence } = forecast;

  const walkInRecovery = sales_gap != null && sales_gap < 0 ? Math.abs(sales_gap) : null;
  const progressPct = target_sales != null && target_sales > 0
    ? Math.min(100, Math.round((forecast_sales / target_sales) * 100))
    : null;

  const notes: string[] = [];
  notes.push(`Forecast confidence: ${confidence}`);
  if (forecast.factors.event_name) notes.push(`Event: ${forecast.factors.event_name}`);

  return {
    source: "forecast",
    sourceLabel: freshnessSourceLabel("forecast", "offline"),
    isLive: false,
    isStale: false,
    freshnessState: "offline",
    freshnessMinutes: null,
    lastUpdatedAt: null,
    businessDate: forecast.date,
    netSales: forecast_sales,
    grossSales: forecast_sales,
    covers: forecast_covers,
    checks: 0,
    averageSpendPerCover: forecast_avg_spend,
    averageCheckValue: forecast_avg_spend,
    labourCostPercent: forecast.factors.latest_labor_pct,
    labourCostAmount: null,
    targetSales: target_sales,
    sameDayLastYearSales: last_year_sales,
    targetSource: target_source,
    targetVarianceAmount: sales_gap,
    targetVariancePercent: sales_gap_pct,
    forecastProgressPercent: progressPct,
    walkInRecoveryNeeded: walkInRecovery,
    additionalCoversNeeded: required_extra_covers > 0 ? required_extra_covers : null,
    bookingsToday,
    bookedCoversToday,
    notes,
  };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Resolve the current sales snapshot from the best available source.
 *
 * Priority:
 *   1. MICROS live data for today (if fresh ≤ STALE_MAX)
 *   2. Manual daily upload for today
 *   3. Revenue forecast (always present)
 */
export async function getCurrentSalesSnapshot(
  businessDate: string,
  microsStatus: MicrosStatusSummary | null,
  forecast: RevenueForecast | null,
  bookingsToday: number | null,
  bookedCoversToday: number | null,
  siteId?: string,
): Promise<NormalizedSalesSnapshot> {
  const logTag = "[SalesSnapshot]";

  // 1. Try MICROS live data — use it for today regardless of sync age
  if (microsStatus?.latestDailySales) {
    const daily = microsStatus.latestDailySales;
    const mins = microsStatus.minutesSinceSync;
    if (daily.business_date === businessDate && daily.net_sales > 0) {
      console.info(`${logTag} source=micros date=${businessDate} net=${daily.net_sales} mins=${mins}`);
      return buildFromMicros(daily, mins, forecast, bookingsToday, bookedCoversToday);
    }
    // If latest row is from a different date and has sales, use it
    if (daily.business_date !== businessDate && daily.net_sales > 0) {
      console.info(`${logTag} source=micros date=${daily.business_date} net=${daily.net_sales} (different date fallback)`);
      const snap = buildFromMicros(daily, mins, forecast, bookingsToday, bookedCoversToday);
      snap.notes = [`Showing ${daily.business_date} (today not yet available)`];
      return snap;
    }
    // Today's row exists but has 0 sales (restaurant not open yet) — fetch yesterday from DB
    if (daily.business_date === businessDate && daily.net_sales === 0 && microsStatus.connection?.id) {
      const yesterdayRow = await fetchYesterdayMicrosRow(microsStatus.connection.id);
      if (yesterdayRow && yesterdayRow.net_sales > 0) {
        console.info(`${logTag} source=micros-yesterday date=${yesterdayRow.business_date} net=${yesterdayRow.net_sales} (today=0 fallback)`);
        const snap = buildFromMicros(yesterdayRow, mins, forecast, bookingsToday, bookedCoversToday);
        snap.notes = [`Showing ${yesterdayRow.business_date} (today's trading not yet started)`];
        return snap;
      }
      console.warn(`${logTag} today=${businessDate} net=0, yesterday has no data either`);
    }
  }

  // 2. Try manual upload for today
  const manual = await getManualSalesForDate(businessDate, siteId);
  if (manual) {
    console.info(`${logTag} source=manual date=${businessDate}`);
    return buildFromManual(manual, forecast, bookingsToday, bookedCoversToday);
  }

  // 3. Forecast fallback
  if (forecast) {
    console.info(`${logTag} source=forecast date=${businessDate} (no MICROS or manual data)`);
    return buildFromForecast(forecast, bookingsToday, bookedCoversToday);
  }

  // 4. Absolute fallback — no data at all
  console.warn(`${logTag} source=NONE date=${businessDate} — no MICROS, manual, or forecast data`);
  return {
    source: "forecast",
    sourceLabel: "NO DATA",
    isLive: false,
    isStale: false,
    freshnessState: "offline",
    freshnessMinutes: null,
    lastUpdatedAt: null,
    businessDate,
    netSales: 0,
    grossSales: 0,
    covers: 0,
    checks: 0,
    averageSpendPerCover: 0,
    averageCheckValue: 0,
    labourCostPercent: null,
    labourCostAmount: null,
    targetSales: null,
    sameDayLastYearSales: null,
    targetSource: null,
    targetVarianceAmount: null,
    targetVariancePercent: null,
    forecastProgressPercent: null,
    walkInRecoveryNeeded: null,
    additionalCoversNeeded: null,
    bookingsToday,
    bookedCoversToday,
    notes: ["No sales data available — upload daily sales or connect MICROS"],
  };
}

// ── Yesterday MICROS fallback ────────────────────────────────────────────────

async function fetchYesterdayMicrosRow(connectionId: string): Promise<MicrosSalesDaily | null> {
  const sb = createServerClient();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split("T")[0];
  const { data } = await sb
    .from("micros_sales_daily")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("business_date", yDate)
    .maybeSingle();
  return (data as MicrosSalesDaily | null) ?? null;
}

// ── Manual upload query ─────────────────────────────────────────────────────

async function getManualSalesForDate(businessDate: string, siteId?: string): Promise<ManualSalesRow | null> {
  const supabase = createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from("manual_sales_uploads") as any)
    .select("*")
    .eq("business_date", businessDate);
  if (siteId) query = query.eq("site_id", siteId);
  const { data } = await query
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ManualSalesRow | null) ?? null;
}

// ── Selector helpers (for widgets) ──────────────────────────────────────────

export function selectRevenueStatus(s: NormalizedSalesSnapshot): {
  label: string;
  color: "emerald" | "amber" | "red" | "stone";
} {
  if (s.targetSales == null) return { label: "No target set", color: "stone" };
  const pct = s.targetVariancePercent ?? 0;
  if (pct >= 0) return { label: "On target", color: "emerald" };
  if (Math.abs(pct) < 20) return { label: `${Math.abs(pct).toFixed(0)}% behind target`, color: "amber" };
  return { label: `${Math.abs(pct).toFixed(0)}% behind target`, color: "red" };
}

export function selectSalesFreshness(s: NormalizedSalesSnapshot): {
  label: string;
  stateLabel: string;
  isHealthy: boolean;
} {
  return {
    label: s.freshnessMinutes != null
      ? (s.freshnessMinutes < 1 ? "now" : s.freshnessMinutes < 60 ? `${s.freshnessMinutes}m ago` : `${Math.floor(s.freshnessMinutes / 60)}h ago`)
      : "unknown",
    stateLabel: s.sourceLabel,
    isHealthy: s.isLive || s.source === "manual",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
