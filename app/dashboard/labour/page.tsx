/**
 * /dashboard/labour — Labour cost dashboard page.
 *
 * Server component that fetches labour summary and renders
 * the LabourDashboardClient with data props.
 */

import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getStoredDailySummary, buildDailySummary } from "@/services/micros/labour/summary";
import { getMockLabourSummary } from "@/services/micros/labour/mock";
import LabourDashboardClient from "@/components/dashboard/labour/LabourDashboardClient";
import type { LabourDashboardSummary } from "@/types/labour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LabourPage() {
  const cfg = getMicrosEnvConfig();
  let summary: LabourDashboardSummary | null = null;
  let loadError: string | null = null;
  let useMock = false;

  if (cfg.enabled && cfg.locRef) {
    try {
      // Try stored summary first (fast), fall back to live computation
      summary = await getStoredDailySummary(cfg.locRef);
      if (!summary) {
        summary = await buildDailySummary(cfg.locRef);
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load labour data";
    }
  }

  // Use mock data in development when no real data is available
  if (!summary && !loadError) {
    if (process.env.NODE_ENV === "development") {
      summary = getMockLabourSummary();
      useMock = true;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">
          Labour
        </h1>
        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
          Staff costs, hours & overtime
        </p>
      </div>
      <LabourDashboardClient
        summary={summary}
        loadError={loadError}
        useMock={useMock}
      />
    </div>
  );
}
