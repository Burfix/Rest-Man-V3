/**
 * GMCoPilot — Main forecast dashboard client component
 *
 * Fetches the briefing from the API and renders all panels.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { GMBriefing } from "@/types/forecast";
import GMBriefingCard from "./GMBriefingCard";
import RecommendedActionsPanel from "./RecommendedActionsPanel";
import HourlyDemandChart from "./HourlyDemandChart";
import ForecastVsActualCard from "./ForecastVsActualCard";
import RiskRadarCard from "./RiskRadarCard";
import PrepGuidanceCard from "./PrepGuidanceCard";
import PromotionInsightCard from "./PromotionInsightCard";
import FoodCostRiskCard from "./FoodCostRiskCard";

export default function GMCoPilot() {
  const [briefing, setBriefing] = useState<GMBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBriefing = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/forecast/briefing");
      if (!res.ok) throw new Error("Failed to load briefing");
      const data: GMBriefing = await res.json();
      setBriefing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load briefing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={fetchBriefing} />;
  if (!briefing) return null;

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
            <span className="text-lg text-white">🧭</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">
              GM Co-Pilot
            </h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Forecast &amp; guidance engine
            </p>
          </div>
        </div>
        <button
          onClick={fetchBriefing}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Zone 1: Briefing + Forecast vs Actual */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <GMBriefingCard briefing={briefing} />
        </div>
        <div className="lg:col-span-2">
          <ForecastVsActualCard
            pacing={briefing.pacing}
            salesForecast={briefing.salesForecast}
            coversForecast={briefing.coversForecast}
          />
        </div>
      </div>

      {/* Zone 2: Recommended Actions */}
      <RecommendedActionsPanel recommendations={briefing.recommendations} />

      {/* Zone 3: Hourly Demand + Risk Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <HourlyDemandChart
            hourly={briefing.hourlyBreakdown}
            peakWindow={briefing.peakWindow}
          />
        </div>
        <div className="lg:col-span-2">
          <RiskRadarCard risk={briefing.riskAssessment} />
        </div>
      </div>

      {/* Zone 4: Food Cost + Prep Guidance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FoodCostRiskCard />
        <PrepGuidanceCard items={briefing.prepGuidance} />
      </div>

      {/* Zone 5: Promo Insight */}
      <PromotionInsightCard promos={briefing.promoInsights} />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-stone-200 dark:bg-stone-800" />
        <div>
          <div className="h-4 w-28 rounded bg-stone-200 dark:bg-stone-800" />
          <div className="h-3 w-44 rounded bg-stone-100 dark:bg-stone-800/50 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-72 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
        <div className="lg:col-span-2 h-72 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
      </div>
      <div className="h-48 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-64 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
        <div className="lg:col-span-2 h-64 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-8 text-center">
      <p className="text-sm font-semibold text-red-700 dark:text-red-400">
        Failed to load GM Co-Pilot
      </p>
      <p className="text-xs text-red-500 dark:text-red-500/80 mt-1">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
