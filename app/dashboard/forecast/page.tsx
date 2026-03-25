/**
 * ForgeStack GM Co-Pilot v2 — Service-Led AI GM Co-Pilot
 *
 * "Revenue follows service quality."
 *
 * Layout:
 *   Hero (briefing + urgency + metrics)
 *   ├─ Main: Top Decisions → All Decisions → Insights
 *   └─ Sidebar: Operating Score → Business Status → Service Pulse → Data Health
 *   Footer: Timestamp
 */

import { runCopilot } from "@/lib/copilot/orchestrator";

import CopilotHero       from "@/components/copilot/CopilotHero";
import TopDecisions      from "@/components/copilot/TopDecisions";
import AllDecisions      from "@/components/copilot/AllDecisions";
import InsightsPanel     from "@/components/copilot/InsightsPanel";
import ServicePulseCard  from "@/components/copilot/ServicePulseCard";
import BusinessStatus    from "@/components/copilot/BusinessStatus";
import DataHealth        from "@/components/copilot/DataHealth";
import OperatingScoreCard from "@/components/copilot/OperatingScoreCard";
import CopilotTimestamp  from "@/components/copilot/CopilotTimestamp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GMCoPilotPage() {
  const copilot = await runCopilot();

  return (
    <div className="space-y-4">
      {/* 1. Hero — urgency, headline, key metrics */}
      <CopilotHero brief={copilot.brief} />

      {/* 2. Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main column (2/3) */}
        <div className="lg:col-span-2 space-y-4">
          <TopDecisions decisions={copilot.decisions} />
          <AllDecisions decisions={copilot.decisions} />
          <InsightsPanel insights={copilot.insights} />
        </div>

        {/* Sidebar (1/3) */}
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

      {/* 3. Timestamp */}
      <CopilotTimestamp generatedAt={copilot.generatedAt} />
    </div>
  );
}
