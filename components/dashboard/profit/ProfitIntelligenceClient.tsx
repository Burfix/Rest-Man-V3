/**
 * components/dashboard/profit/ProfitIntelligenceClient.tsx
 *
 * Profit Intelligence — main client shell for store managers and head office.
 *
 * Layout (store manager view):
 *   Header (store name + date range selector)
 *   Revenue Mission Bar (KPI strip with progress bar + traffic lights)
 *   Active Alerts | Profit Bridge (2-col grid)
 *   Playbook (recommended actions)
 *   Data Quality
 *
 * Additional for head office / executive:
 *   All Stores — Profit Overview (HeadOfficeProfitTable)
 *
 * Fetches from /api/profit/intelligence and /api/profit/group on range change.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ProfitKpiStrip }          from "./ProfitKpiStrip";
import { ProfitBridgePanel }        from "./ProfitBridgePanel";
import { ProfitLeaksPanel }         from "./ProfitLeaksPanel";
import { RecommendedActionsPanel }  from "./RecommendedActionsPanel";
import { DataQualityPanel }         from "./DataQualityPanel";
import { HeadOfficeProfitTable }    from "./HeadOfficeProfitTable";
import { ProfitEmptyState }         from "./ProfitEmptyState";
import type {
  ProfitIntelligenceResult,
  GroupProfitIntelligenceResult,
  ProfitDateRange,
} from "@/lib/profit/types";

// ── Date range selector ───────────────────────────────────────────────────────

const DATE_RANGES: { value: ProfitDateRange; label: string }[] = [
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d",        label: "7 Days" },
  { value: "mtd",       label: "MTD" },
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

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-32 rounded-xl bg-stone-100 dark:bg-stone-800" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-xl bg-stone-100 dark:bg-stone-800" />
        <div className="h-72 rounded-xl bg-stone-100 dark:bg-stone-800" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialData: ProfitIntelligenceResult;
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
  const [groupData, setGroupData] = useState<GroupProfitIntelligenceResult | null>(
    initialGroupData ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async (r: ProfitDateRange) => {
    setLoading(true);
    setError(null);
    try {
      const [piRes, groupRes] = await Promise.all([
        fetch(`/api/profit/intelligence?range=${r}`),
        isOrgUser ? fetch(`/api/profit/group?range=${r}`) : Promise.resolve(null),
      ]);

      if (!piRes.ok) throw new Error("Failed to load profit data");
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

  // Refetch when range changes (skip initial SSR render which already has data)
  useEffect(() => {
    if (range !== initialData.dateRange) {
      void fetchData(range);
    }
  }, [range, initialData.dateRange, fetchData]);

  const s = data.currencySymbol || currencySymbol;

  // Empty state: low confidence + no revenue at all
  const isEmpty = data.dataQuality.confidenceLevel === "low" && !data.revenue;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight">
            Profit Intelligence
          </h1>
          <p className="text-[12px] text-stone-500 mt-0.5">
            {data.siteName && data.siteName !== "Unknown" ? data.siteName : ""}
            {data.businessDate
              ? ` · ${new Date(data.businessDate + "T00:00:00").toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}`
              : ""}
          </p>
        </div>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {loading && <LoadingSkeleton />}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/15 px-5 py-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">{error}</p>
          <p className="text-[11px] text-red-600/70 dark:text-red-400/70 mt-1">
            Try refreshing or selecting a different date range.
          </p>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {!loading && !error && (
        isEmpty ? (
          <ProfitEmptyState />
        ) : (
          <div className="flex flex-col gap-5">
            {/* 1. Revenue Mission Bar + traffic-light metric tiles */}
            <ProfitKpiStrip data={data} />

            {/* 2. Active Alerts (left priority) + Profit Bridge (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ProfitLeaksPanel leaks={data.keyDrivers} symbol={s} />
              <ProfitBridgePanel bridge={data.profitBridge} symbol={s} />
            </div>

            {/* 3. Playbook — profit-driven recommended actions */}
            {data.recommendedActions.length > 0 && (
              <RecommendedActionsPanel
                actions={data.recommendedActions}
                siteId={siteId}
              />
            )}

            {/* 4. Head office multi-store view (executive / head_office roles) */}
            {isOrgUser && groupData && (
              <div>
                <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 mb-3">
                  All Stores — Profit Overview
                </h2>
                <HeadOfficeProfitTable data={groupData} symbol={s} />
              </div>
            )}

            {/* 5. Data quality — always last */}
            <DataQualityPanel quality={data.dataQuality} />
          </div>
        )
      )}
    </div>
  );
}
