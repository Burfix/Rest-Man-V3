/**
 * Action Impact Measurement
 *
 * measureActionImpact(actionId) → ActionImpact
 *
 * Compares before/after metrics when an action is completed
 * to estimate the operational and financial impact.
 */

import type { ActionImpact } from "./types";
import { createServerClient } from "@/lib/supabase/server";

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export async function measureActionImpact(actionId: string): Promise<ActionImpact | null> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .single();

  if (!data) return null;

  // Cast to any — columns from migration 035 not yet in generated DB types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const action = data as any;

  const beforeMetric = action.revenue_before ?? null;
  const afterMetric = action.revenue_after ?? null;
  const delta = action.revenue_delta ?? (beforeMetric != null && afterMetric != null ? afterMetric - beforeMetric : null);

  // ── Build impact summary ──────────────────────────────────────────────────

  let impactSummary: string;
  const category = action.category ?? "general";

  if (delta != null && delta > 0) {
    impactSummary = `Revenue increased by ${rands(delta)} after action completion`;
  } else if (delta != null && delta < 0) {
    impactSummary = `Revenue decreased by ${rands(Math.abs(delta))} — action may not have been effective`;
  } else {
    // Estimate impact by category
    switch (category) {
      case "labour":
        impactSummary = action.expected_impact ?? "Labour cost adjustment applied";
        break;
      case "stock":
      case "food_cost":
        impactSummary = "Stockout risk resolved — menu availability protected";
        break;
      case "compliance":
        impactSummary = "Compliance risk reduced — regulatory exposure closed";
        break;
      case "maintenance":
        impactSummary = "Maintenance issue resolved — service capacity restored";
        break;
      case "service":
        impactSummary = "Service intervention applied — monitoring impact";
        break;
      default:
        impactSummary = action.expected_impact ?? "Action completed — impact pending measurement";
    }
  }

  // ── Estimate operating score contribution ───────────────────────────────

  let scoreContribution: number | null = null;
  if (delta != null && delta > 0) scoreContribution = Math.min(5, Math.round(delta / 1000));
  else if (category === "compliance") scoreContribution = 3;
  else if (category === "maintenance") scoreContribution = 2;
  else if (category === "labour") scoreContribution = 2;

  const impact: ActionImpact = {
    actionId,
    impactSummary,
    beforeMetric,
    afterMetric,
    estimatedImpactValue: delta,
    operatingScoreContribution: scoreContribution,
    measuredAt: new Date().toISOString(),
  };

  // ── Persist impact data back to action ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("actions")
    .update({
      impact_summary: impactSummary,
      impact_after: { revenue: afterMetric, delta, scoreContribution },
    })
    .eq("id", actionId);

  // ── Write impact event ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("action_events").insert({
    action_id: actionId,
    event_type: "impact_measured",
    notes: impactSummary,
    metadata: { beforeMetric, afterMetric, delta, scoreContribution },
  });

  return impact;
}
