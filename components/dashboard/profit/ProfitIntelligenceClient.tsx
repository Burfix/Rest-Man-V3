/**
 * components/dashboard/profit/ProfitIntelligenceClient.tsx
 *
 * Main client shell for the Profit Intelligence page.
 *
 * Renders:
 *  - Date range selector
 *  - KPI strip
 *  - Profit Bridge (left) + Profit Leaks (right)
 *  - Recommended Actions
 *  - Data Quality panel
 *  - Head Office multi-store table (conditional on role)
 *
 * Fetches from /api/profit/intelligence and /api/profit/group via
 * client-side fetch on date range change.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ProfitKpiStrip }            from "./ProfitKpiStrip";
import { ProfitBridgePanel }         from "./ProfitBridgePanel";
import { ProfitLeaksPanel }          from "./ProfitLeaksPanel";
import { RecommendedActionsPanel }   from "./RecommendedActionsPanel";
import { DataQualityPanel }          from "./DataQualityPanel";
import { HeadOfficeProfitTable }     from "./HeadOfficeProfitTable";
import { ProfitEmptyState }          from "./ProfitEmptyState";
import type { ProfitIntelligenceResult, GroupProfitIntelligenceResult, ProfitDateRange } from "@/lib/profit/types";

// ── Date range tab ────────────────────────────────────────────────────────────

const DATE_RANGES: { value: ProfitDateRange; label: string }[] = [
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d",        label: "7 Days" },
  { value: "mtd",       label: "Month to Date" },
];

function DateRangeSelector({
  value,
  onChange,
}: {
  value: ProfitDateRange;
  onChange: (v: ProfitDateRange) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-1">
      {DATE_RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all",
            value === r.value
              ? "bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm"
              : "text-stone-500 hover:text-stone-700 dark:hover:text-stone-300",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ── Profit at risk banner ─────────────────────────────────────────────────────

function ProfitAtRiskBanner({ explanation }: { explanation: string }) {
  return (
    <div className="rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/40 px-5 py-3 flex items-start gap-3">
      <span className="text-red-500 text-lg shrink-0 mt-0.5">⚠</span>
      <p className="text-sm font-semibold text-red-800 dark:text-red-300 leading-relaxed">
        {explanation}
      </p>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-xl bg-stone-100 dark:bg-stone-800" />
        <div className="h-72 rounded-xl bg-stone-100 dark:bg-stone-800" />
      </div>
      <div className="h-48 rounded-xl bg-stone-100 dark:bg-stone-800" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  /** Pre-fetched on server for initial render */
  initialData: ProfitIntelligenceResult;
  /** Present only for head office / executive roles */
  initialGroupData?: GroupProfitIntelligenceResult | null;
  isOrgUser: boolean;
  siteId: string;
  currencySymbol: string;
}

export function ProfitIntelligenceClient({
  initialData,
  initialGroupData,
  isOrgUser,
  siteId,
  currencySymbol,
}: Props) {
  const [range, setRange]         = useState<ProfitDateRange>(initialData.dateRange);
  const [data, setData]           = useState<ProfitIntelligenceResult>(initialData);
  const [groupData, setGroupData] = useState<GroupProfitIntelligenceResult | null>(initialGroupData ?? null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const fetchData = useCallback(async (r: ProfitDateRange) => {
    setLoading(true);
    setError(null);
    try {
      const [piRes, groupRes] = await Promise.all([
        fetch(`/api/profit/intelligence?range=${r}`),
        isOrgUser ? fetch(`/api/profit/group?range=${r}`) : Promise.resolve(null),
      ]);

      if (!piRes.ok) throw new Error("Failed to load profit intelligence");
      const piJson = await piRes.json();
      setData(piJson.data);

      if (groupRes?.ok) {
        const groupJson = await groupRes.json();
        setGroupData(groupJson.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [isOrgUser]);

  // Refetch when range changes (skip initial render since we have SSR data)
  useEffect(() => {
    if (range !== initialData.dateRange) {
      fetchData(range);
    }
  }, [range, initialData.dateRange, fetchData]);

  const isEmpty = data.dataQuality.confidenceLevel === "low" && !data.revenue;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight">
            Profit Intelligence
          </h1>
          <p className="text-[12px] text-stone-500 mt-0.5">
            {data.siteName} · {data.dataQuality.summary}
          </p>
        </div>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>

      {/* ── Loading / error ────────────────────────────────────────────── */}
      {loading && <LoadingSkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/15 px-5 py-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {isEmpty ? (
            <ProfitEmptyState />
          ) : (
            <>
              {/* Profit at risk banner */}
              {data.profitAtRiskExplanation && (
                <ProfitAtRiskBanner explanation={data.profitAtRiskExplanation} />
              )}

              {/* KPI strip */}
              <ProfitKpiStrip data={data} />

              {/* Bridge + Leaks */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ProfitBridgePanel bridge={data.profitBridge} symbol={currencySymbol} />
                <ProfitLeaksPanel leaks={data.keyDrivers} symbol={currencySymbol} />
              </div>

              {/* Recommended actions */}
              {data.recommendedActions.length > 0 && (
                <RecommendedActionsPanel
                  actions={data.recommendedActions}
                  siteId={siteId}
                />
              )}

              {/* Head office multi-store view */}
              {isOrgUser && groupData && (
                <div>
                  <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 mb-3">
                    All Stores — Profit Overview
                  </h2>
                  <HeadOfficeProfitTable data={groupData} symbol={currencySymbol} />
                </div>
              )}

              {/* Data quality */}
              <DataQualityPanel quality={data.dataQuality} />
            </>
          )}
        </>
      )}
    </div>
  );
}
