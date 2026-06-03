"use client";

import { useState, useCallback, useTransition } from "react";
import type { PlatformAdoptionAnalytics } from "@/lib/adoption/types";
import AdoptionScoreCard from "./AdoptionScoreCard";
import ChampionCard from "./ChampionCard";
import AtRiskCard from "./AtRiskCard";
import FeatureAdoptionChart from "./FeatureAdoptionChart";
import UserEngagementTable from "./UserEngagementTable";
import { cn } from "@/lib/utils";

interface Props {
  initialData:  PlatformAdoptionAnalytics | null;
  fetchError:   string | null;
}

export default function PlatformAdoptionClient({ initialData, fetchError }: Props) {
  const [data, setData]       = useState<PlatformAdoptionAnalytics | null>(initialData);
  const [error, setError]     = useState<string | null>(fetchError);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/adoption/analytics", { cache: "no-store" });
        const json = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json.data);
          setError(null);
        }
      } catch (err) {
        setError(String(err));
      }
    });
  }, []);

  const computedAt = data?.computedAt
    ? new Date(data.computedAt).toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 tracking-tight">
            Platform Adoption
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Usage intelligence across Primi, Si Cantina &amp; Sea Castle&nbsp;
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
              Super Admin
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {computedAt && (
            <p className="text-xs text-stone-400 dark:text-stone-600">
              Updated {computedAt}
            </p>
          )}
          <button
            onClick={refresh}
            disabled={isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-stone-200 dark:border-stone-700",
              "bg-white dark:bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-300",
              "hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isPending ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-stone-400 border-t-stone-700" />
            ) : (
              "↻"
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <span className="font-semibold">Error:</span> {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
          <p className="text-sm text-stone-400">No adoption data yet — users need to log in first.</p>
        </div>
      )}

      {data && (
        <>
          {/* ── Score cards ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <AdoptionScoreCard
              label="Adoption Score"
              description="Users active in last 7 days"
              score={data.adoptionScore.score}
              trend={data.adoptionScore.trend}
              detail={`${data.adoptionScore.activeUsers7d} of ${data.adoptionScore.totalUsers} users`}
              color="emerald"
            />
            <AdoptionScoreCard
              label="Engagement Score"
              description="Average composite engagement"
              score={data.engagementScore.score}
              trend={data.engagementScore.trend}
              detail={`${data.userEngagement.length} tracked users`}
              color="blue"
            />
            <AdoptionScoreCard
              label="Feature Adoption"
              description="Avg feature uptake across all users"
              score={data.featureAdoption.score}
              trend={0}
              detail={`${data.featureAdoption.byFeature.length} features tracked`}
              color="violet"
            />
          </div>

          {/* ── Champions & At-Risk ──────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChampionCard champions={data.champions} />
            <AtRiskCard atRiskUsers={data.atRiskUsers} />
          </div>

          {/* ── Feature adoption chart ───────────────────────────────── */}
          <FeatureAdoptionChart entries={data.featureAdoption.byFeature} />

          {/* ── User engagement table ────────────────────────────────── */}
          <UserEngagementTable users={data.userEngagement} />
        </>
      )}
    </div>
  );
}
