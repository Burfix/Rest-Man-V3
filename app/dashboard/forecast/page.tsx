/**
 * ForgeStack GM Co-Pilot v2 — Service-Led AI GM Co-Pilot
 *
 * "Revenue follows service quality."
 *
 * Desktop Layout:
 *   Hero (briefing + urgency + metrics)
 *   ├─ Main: Top Decisions → All Decisions → Insights
 *   └─ Sidebar: Operating Score → Business Status → Service Pulse → Data Health
 *   Footer: Timestamp
 *
 * Mobile Layout (stacked, thumb-friendly):
 *   MobileHero → MobileDecisions → MobileServicePulse →
 *   MobileBusinessSnapshot → MobileShiftReview → Timestamp
 */

import { runCopilot } from "@/lib/copilot/orchestrator";
import { getUserContext } from "@/lib/auth/get-user-context";
import { runOperatingBrain } from "@/services/brain/operating-brain";
import { todayISO } from "@/lib/utils";
import BrainCopilotHero from "@/components/brain/BrainCopilotHero";
import BrainTopDecisions from "@/components/brain/BrainTopDecisions";
import RecoveryMeter     from "@/components/brain/RecoveryMeter";

import AllDecisions      from "@/components/copilot/AllDecisions";
import InsightsPanel     from "@/components/copilot/InsightsPanel";
import ServicePulseCard  from "@/components/copilot/ServicePulseCard";
import BusinessStatus    from "@/components/copilot/BusinessStatus";
import DataHealth        from "@/components/copilot/DataHealth";
import OperatingScoreCard from "@/components/copilot/OperatingScoreCard";
import CopilotTimestamp  from "@/components/copilot/CopilotTimestamp";

import MobileHero             from "@/components/copilot/mobile/MobileHero";
import MobileDecisions        from "@/components/copilot/mobile/MobileDecisions";
import MobileServicePulse     from "@/components/copilot/mobile/MobileServicePulse";
import MobileBusinessSnapshot from "@/components/copilot/mobile/MobileBusinessSnapshot";
import MobileShiftReview      from "@/components/copilot/mobile/MobileShiftReview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GMCoPilotPage() {
  // Get siteId early so brain can run in parallel with copilot
  const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";
  let siteId = DEFAULT_SITE_ID;
  try {
    const userCtx = await getUserContext();
    siteId = userCtx.siteId;
  } catch {}

  const brainPromise = runOperatingBrain(siteId, todayISO());
  const copilot = await runCopilot();

  const brain = await brainPromise.catch(() => null);

  // Build a simple shift review from the current data
  const actionsTotal = copilot.decisions.length;
  const actionsCompleted = copilot.decisions.filter(
    (d) => d.status === "completed",
  ).length;

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
         DESKTOP LAYOUT — hidden on mobile, visible on lg+
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block space-y-4">
        {brain ? <BrainCopilotHero brain={brain} /> : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {brain && <BrainTopDecisions brain={brain} />}
            {brain && <RecoveryMeter brain={brain} />}
            <AllDecisions decisions={copilot.decisions} />
            <InsightsPanel insights={copilot.insights} />
          </div>

          <div className="space-y-4">
            <OperatingScoreCard score={copilot.operatingScore} />
            <BusinessStatus brief={copilot.brief} score={copilot.operatingScore} />
            <ServicePulseCard
              serviceState={copilot.serviceState}
              serviceImpact={copilot.serviceImpact}
            />
            <DataHealth trust={copilot.trustState} />
          </div>
        </div>

        <CopilotTimestamp generatedAt={copilot.generatedAt} />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
         MOBILE LAYOUT — visible on mobile, hidden on lg+
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden space-y-3 pb-6">
        <MobileHero
          brief={copilot.brief}
          serviceScore={copilot.serviceScore}
        />
        <MobileDecisions decisions={copilot.decisions} />
        <MobileServicePulse
          serviceState={copilot.serviceState}
          serviceImpact={copilot.serviceImpact}
          serviceScore={copilot.serviceScore}
        />
        <MobileBusinessSnapshot
          brief={copilot.brief}
          score={copilot.operatingScore}
        />
        <MobileShiftReview
          shiftType={
            copilot.brief.serviceWindow.includes("lunch") ? "lunch" :
            copilot.brief.serviceWindow.includes("dinner") ? "dinner" : "full_day"
          }
          serviceScore={copilot.serviceScore.totalScore}
          serviceGrade={copilot.serviceScore.serviceGrade}
          revenueRecovered={0}
          actionsCompleted={actionsCompleted}
          actionsTotal={actionsTotal}
          carryForwardActions={actionsTotal - actionsCompleted}
          isRecoveryShift={false}
          shiftSummary={copilot.brief.summary}
        />
        <CopilotTimestamp generatedAt={copilot.generatedAt} />
      </div>
    </>
  );
}
