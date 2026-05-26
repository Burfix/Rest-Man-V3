/**
 * ForgeStack Operating Brain v3 — Command Center (Single Source of Truth)
 *
 * ALL data flows through buildCommandCenterState().
 * NO panel calculates its own score, grade, or risk values.
 *
 * Layout:
 *   1. HeroStrip            — operating score + KPI pills + sync status
 *   2. PriorityActionBoard  — duty tasks + action queue
 *   3. CommandFeed          — ranked operational decisions
 *   4. ServicePulse         — revenue pacing
 *   5. BusinessStatusRail   — module status overview
 *   6. FeedbackLoop         — score progress + trend
 *   7. SecondaryInsights    — reviews + maintenance drilldowns
 *
 * Architecture rule:
 *   buildCommandCenterState() is the ONLY function that may compute:
 *     - Operating score / grade
 *     - Revenue gap or variance
 *     - Labour risk status
 *     - Compliance status
 *     - Maintenance status
 *     - Hero severity
 *   This file extracts from `result` and passes to components. Zero local derivation.
 */

import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { resolvePageSite }           from "@/lib/auth/resolve-site";
import { redirect }                  from "next/navigation";
import { buildCommandCenterState }   from "@/lib/command-center/build-command-center-state";

import AccountabilityAlert  from "@/components/accountability/AccountabilityAlert";
import HeroStrip            from "@/components/brain/HeroStrip";
import PriorityActionBoard  from "@/components/brain/PriorityActionBoard";
import CommandFeed          from "@/components/operating-brain/CommandFeedV2";
import ServicePulse         from "@/components/operating-brain/ServicePulse";
import BusinessStatusRail   from "@/components/operating-brain/BusinessStatusRail";
import FeedbackLoop         from "@/components/operating-brain/FeedbackLoop";
import DataHealthWarning    from "@/components/operating-brain/DataHealthWarning";
import SecondaryInsights    from "@/components/dashboard/SecondaryInsights";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default async function OperationsDashboard({
  searchParams,
}: {
  searchParams?: { site_id?: string };
}) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const ctx = await getUserContext().catch((err: unknown) => {
    if (err instanceof AuthError && err.statusCode === 401) redirect("/login");
    return null;
  });

  if (!ctx?.siteId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No site assigned. Contact your administrator.
        </p>
      </div>
    );
  }

  const { siteId } = resolvePageSite(ctx, searchParams?.site_id);
  const { orgId }  = ctx;

  // ── ONE call — all data, ONE canonical state ──────────────────────────────
  // buildCommandCenterState:
  //   • fetches all raw data in parallel
  //   • runs the brain (canonical scorer: Rev 30 | Lab 20 | Duties 20 | Maint 15 | Comp 15)
  //   • runs evaluateOperations with the SAME inputs as the brain → no divergence
  //   • derives hero, businessStatus, systemPulse, commandFeed from ONE score
  //
  // Extract from `result`. Do NOT re-derive any risk values in this file.
  const result = await buildCommandCenterState(siteId, orgId ?? undefined);
  const { state, extras } = result;

  const {
    brain,
    salesSnapshot,
    salesProvenance,
    inventoryProvenance,
    dutiesData,
    engineOutput,
    predictive,
    feedbackProps,
    forecast,
    servicePeriod,
    salesAgeMinutes,
    reviews,
    maintenance,
  } = extras;

  return (
    <div className="space-y-0">

      {/* ── LAYER 1 — Hero Strip (score · KPIs · sync) ─────────────────────── */}
      {/* Score comes from brain.systemHealth — same engine as canonical state. */}
      {brain && (
        <HeroStrip
          brain={brain}
          salesSnapshot={salesSnapshot}
          revenueVariance={state.revenue.gapPct}
          servicePeriod={servicePeriod}
          freshnessMinutes={salesAgeMinutes}
        />
      )}

      {/* ── LAYER 2 — Priority Action Board ─────────────────────────────────── */}
      {brain && (
        <PriorityActionBoard brain={brain} siteId={siteId} dutiesData={dutiesData} />
      )}

      {/* ── LAYER 3 — Detail layer (below fold) ─────────────────────────────── */}
      <div className="space-y-4 pt-4">

        <AccountabilityAlert />

        {/* ── Main Grid: Primary + Secondary ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Primary Column */}
          <div className="lg:col-span-8 space-y-4">

            {/* CommandFeed — decisions from evaluateOperations (same inputs as brain). */}
            <CommandFeed decisions={engineOutput.commandFeed} />

            {/* ServicePulse — reads from canonical state.revenue — no local derivation. */}
            <ServicePulse
              actual={state.revenue.actual}
              target={state.revenue.target}
              variancePercent={state.revenue.gapPct}
              covers={salesSnapshot.covers}
              avgSpend={
                salesSnapshot.covers > 0
                  ? state.revenue.actual / salesSnapshot.covers
                  : 0
              }
              peakWindow={undefined}
              timeToPeakMinutes={null}
              forecastCovers={forecast?.forecast_covers}
              insights={engineOutput.servicePulseInsights}
              isLive={salesSnapshot.isLive}
              source={salesSnapshot.source}
              sourceNote={salesSnapshot.notes?.[0]}
              dataSource={salesSnapshot.data_source}
              provenance={salesProvenance}
            />
          </div>

          {/* Secondary Column */}
          <div className="lg:col-span-4 space-y-4">

            {/* BusinessStatusRail — evaluateOperations.businessStatus (same inputs). */}
            <BusinessStatusRail
              status={engineOutput.businessStatus}
              predictive={predictive}
            />

            {/* FeedbackLoop — canonical grade thresholds from spec (A≥85 B≥70 C≥55 D≥40). */}
            <FeedbackLoop {...feedbackProps} />
          </div>
        </div>

        {/* ── Data health / partial-data banner ── */}
        <DataHealthWarning
          health={engineOutput.dataHealth}
          inventoryProvenance={inventoryProvenance}
        />

        {/* ── Secondary Drilldowns (display-only; not part of score engine) ── */}
        <SecondaryInsights
          reviews={reviews}
          maintenance={maintenance}
          hasReviews={reviews.totalReviews > 0}
        />
      </div>
    </div>
  );
}
