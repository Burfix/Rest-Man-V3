/**
 * /dashboard/labour — Labour cost dashboard page.
 *
 * Server component that fetches labour summary and renders
 * the LabourDashboardClient with data props.
 */

import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getStoredDailySummary, buildDailySummary } from "@/services/micros/labour/summary";
import { getMockLabourSummary } from "@/services/micros/labour/mock";
import { getMicrosConnection } from "@/services/micros/status";
import LabourDashboardClient from "@/components/dashboard/labour/LabourDashboardClient";
import type { LabourDashboardSummary } from "@/types/labour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LabourPage() {
  const cfg = getMicrosEnvConfig();
  let summary: LabourDashboardSummary | null = null;
  let loadError: string | null = null;
  let useMock = false;

  // Prefer DB connection locRef over env var
  const connection = await getMicrosConnection().catch(() => null);
  const locRef = connection?.loc_ref ?? cfg.locRef;

  if (cfg.enabled && locRef) {
    try {
      summary = await getStoredDailySummary(locRef);
      if (!summary) {
        summary = await buildDailySummary(locRef);
      }
      // If today has no data (no timecards yet), fall back to yesterday
      if (!summary || (summary.totalLabourHours === 0 && summary.activeStaffCount === 0)) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yDate = yesterday.toISOString().split("T")[0];
        const fallback = await getStoredDailySummary(locRef, yDate);
        if (fallback && fallback.totalLabourHours > 0) {
          summary = fallback;
        }
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
