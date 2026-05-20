/**
 * /dashboard/labour — Labour cost dashboard page.
 *
 * Server component that fetches labour summary for the authenticated user's
 * assigned site.  Never falls back to a global/env MICROS config.
 */

import { redirect }               from "next/navigation";
import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { resolvePageSite }         from "@/lib/auth/resolve-site";
import { getMicrosConnectionBySiteId } from "@/services/micros/status";
import { getStoredDailySummary, buildDailySummary } from "@/services/micros/labour/summary";
import { getMockLabourSummary }   from "@/services/micros/labour/mock";
import { buildDataProvenance }    from "@/lib/types/data-provenance";
import LabourDashboardClient      from "@/components/dashboard/labour/LabourDashboardClient";
import type { LabourDashboardSummary } from "@/types/labour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LabourPage({
  searchParams,
}: {
  searchParams?: { site_id?: string };
}) {
  // ── 1. Resolve authenticated user's site ──────────────────────────────────────
  // getUserContext() throws AuthError(401) when unauthenticated.
  // Never use a global/env fallback — fail closed.
  let siteId: string;
  try {
    const ctx = await getUserContext();
    // URL param takes priority over cookie (supports shared links)
    siteId = resolvePageSite(ctx, searchParams?.site_id).siteId;
  } catch (err) {
    if (err instanceof AuthError && err.statusCode === 401) {
      redirect("/login");
    }
    throw err;
  }

  // ── 2. Resolve MICROS connection for THIS site only ───────────────────────
  // getMicrosConnectionBySiteId is scoped to a single site — it cannot return
  // another site's connection.  No cross-site fallback is performed.
  const connection = await getMicrosConnectionBySiteId(siteId).catch(() => null);

  if (!connection?.loc_ref) {
    // Site has no MICROS connection — show safe "not connected" state.
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
          summary={null}
          loadError={null}
          provenance={buildDataProvenance({ source: "no_connection", siteId })}
        />
      </div>
    );
  }

  const locRef = connection.loc_ref;

  // ── 3. Fetch labour summary for the resolved locRef ───────────────────────
  let summary: LabourDashboardSummary | null = null;
  let loadError: string | null = null;

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

  // Mock data only in development — never in production
  if (!summary && !loadError && process.env.NODE_ENV === "development") {
    summary = getMockLabourSummary();
  }

  // ── 4. Build provenance and render ────────────────────────────────────────
  const isMock = !summary?.lastSyncAt && process.env.NODE_ENV === "development" &&
    !loadError;

  const today = new Date().toISOString().split("T")[0];
  const isYesterdayFallback = summary !== null && summary.businessDate !== today;

  const provenance = buildDataProvenance({
    source:
      !summary && !loadError     ? "no_connection"   :
      isMock                     ? "mock"             :
      isYesterdayFallback        ? "stale_fallback"   :
      "live_micros",
    fetchedAt: summary?.lastSyncAt ?? null,
    staleAfterMinutes: 60,
    locRef: connection.loc_ref,
    siteId,
    reason: isYesterdayFallback ? "No data for today — showing yesterday" : undefined,
  });

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
        provenance={provenance}
      />
    </div>
  );
}

