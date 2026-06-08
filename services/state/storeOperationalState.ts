/**
 * Store Operational State Engine
 *
 * Returns a fully computed StoreOperationalState for a given store
 * and date. Every metric is accompanied by provenance facts that
 * explain how it was derived — enabling "Why this number?" UI panels.
 *
 * Data flows: canonical tables only (never raw_* tables).
 *
 * getStoreOperationalState(storeId, date)
 *   → StoreOperationalState
 */

import { createServerClient } from "@/lib/supabase/server";
import {
  calculateOperatingScore,
  toGrade as libToGrade,
} from "@/lib/scoring/operatingScore";
import { persistOperatingScore } from "@/lib/scores/persistOperatingScore";
import { resolveRevenueTarget, safeLabourPct } from "@/lib/targets/resolveRevenueTarget";
import type {
  StoreOperationalState,
  Store,
  ScoreGrade,
  RiskLevel,
  SourceFact,
} from "@/lib/ontology/entities";

// ── Grade and risk helpers ─────────────────────────────────────────────────────────────────────

function gradeFromScore(score: number): ScoreGrade {
  return libToGrade(score) as ScoreGrade;
}

function riskFromScore(score: number): RiskLevel {
  if (score >= 70) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function getStoreOperationalState(
  storeId: string,
  date:    string  // ISO date "YYYY-MM-DD"
): Promise<StoreOperationalState> {
  const supabase = createServerClient();

  // Parallel data fetch from canonical tables
  const [storeRes, revRes, labourRes, compRes, maintRes, snapRes, actionsRes] =
    await Promise.all([
      supabase.from("sites").select("*").eq("id", storeId).single(),

      supabase.from("revenue_records")
        .select("net_vat_excl, net_sales, covers")
        .eq("site_id", storeId)
        .eq("service_date", date),

      supabase.from("labour_records")
        .select("labour_cost")
        .eq("site_id", storeId)
        .eq("service_date", date),

      supabase.from("compliance_items")
        .select("id, status, is_critical")
        .eq("site_id", storeId)
        .eq("is_active", true),

      supabase.from("maintenance_tickets")
        .select("id, priority, recurrence_count, status")
        .eq("site_id", storeId)
        .not("status", "in", '("resolved","closed")'),

      // Revenue target — canonical waterfall (replaces stale store_snapshots.revenue_target)
      resolveRevenueTarget(storeId, date, supabase as any),

      supabase.from("actions")
        .select("id, status, due_at")
        .eq("site_id", storeId)
        .is("archived_at", null),
    ]);

  if (storeRes.error) throw new Error(`[StateEngine] Store not found: ${storeRes.error.message}`);

  const store         = storeRes.data as Store;
  const revRows       = (revRes.data ?? []) as { net_vat_excl: number | null; net_sales: number | null; covers: number | null }[];
  const labourRows    = (labourRes.data ?? []) as { labour_cost: number | null }[];
  const compItems     = compRes.data ?? [];
  const maintTickets  = maintRes.data ?? [];
  // snapRes is now a RevenueTargetResult from resolveRevenueTarget (not a Supabase response)
  const targetResult  = snapRes as Awaited<ReturnType<typeof resolveRevenueTarget>>;
  const actionRows    = actionsRes.data ?? [];

  // ── Revenue ────────────────────────────────────────────────────────────────
  const salesNetVat = revRows.reduce(
    (sum, r) => sum + (r.net_vat_excl ?? r.net_sales ?? 0), 0
  );
  // Use canonical target resolver — same function as ServicePulse and context-builder
  const revenueTarget = targetResult.target ?? 0;
  const revenueGapAbs = revenueTarget > 0 ? salesNetVat - revenueTarget : null;
  const revenueGapPct = revenueTarget > 0
    ? +((salesNetVat - revenueTarget) / revenueTarget * 100).toFixed(2)
    : null;

  // ── Labour ─────────────────────────────────────────────────────────────────
  const labourCost      = labourRows.reduce((sum, r) => sum + (r.labour_cost ?? 0), 0);
  // safeLabourPct guard: returns null if revenue < R500 to prevent inflated percentages
  const labourPct       = safeLabourPct(labourCost, salesNetVat);
  const targetLabourPct = store.target_labour_pct ?? 30;

  // ── Compliance ─────────────────────────────────────────────────────────────
  const complianceOverdue  = compItems.filter((c: any) => c.status === "overdue").length;
  const complianceDueSoon  = compItems.filter((c: any) => c.status === "due_soon").length;

  // ── Maintenance ────────────────────────────────────────────────────────────
  const maintenanceCritical = maintTickets.filter(
    (t: any) => t.priority === "critical" || t.priority === "high"
  ).length;
  const maintenanceRepeat = maintTickets.filter((t: any) => t.recurrence_count > 1).length;

  // ── Operating score — canonical formula ───────────────────────────────────
  const scoreInput = {
    actualRevenue:         salesNetVat,
    targetRevenue:         revenueTarget,
    labourPct,
    targetLabourPct,
    expiredItems:          complianceOverdue,
    dueSoonItems:          complianceDueSoon,
    criticalIssues:        maintenanceCritical,
  };
  console.log("SCORE INPUT [services/state/storeOperationalState]:", {
    ...scoreInput,
    // guard checks
    revenueTargetZero:  revenueTarget === 0,
    labourPctFromRevenue: salesNetVat === 0 ? "WARN: labourPct derived from zero revenue" : "ok",
  });
  const scoreResult = calculateOperatingScore(scoreInput);
  const score    = scoreResult.score;
  const breakdown = {
    revScore:   scoreResult.components.revenue.rawScore,
    labScore:   scoreResult.components.labour.rawScore,
    compScore:  scoreResult.components.compliance.rawScore,
    maintScore: scoreResult.components.maintenance.rawScore,
  };

  // Persist score — fire-and-forget, never blocks render
  void persistOperatingScore({
    storeId:    storeId,
    scoreDate:  date,
    totalScore: score,
    grade:      gradeFromScore(score),
    breakdown: {
      revenue:     scoreResult.components.revenue,
      labour:      scoreResult.components.labour,
      service:     scoreResult.components.service,
      compliance:  scoreResult.components.compliance,
      maintenance: scoreResult.components.maintenance,
      inputs:      scoreInput,
      source:      "storeOperationalState",
    } as Record<string, unknown>,
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  const now = Date.now();
  const actionsOpen = actionRows.filter(
    (a: any) => !["completed", "cancelled"].includes(a.status)
  ).length;
  const actionsOverdue = actionRows.filter(
    (a: any) => a.due_at && new Date(a.due_at).getTime() < now &&
      !["completed", "cancelled"].includes(a.status)
  ).length;
  const total      = actionRows.length;
  const completed  = actionRows.filter((a: any) => a.status === "completed").length;
  const actionsCompletionPct = total > 0 ? Math.round(completed / total * 100) : null;

  // ── Provenance ─────────────────────────────────────────────────────────────
  const provenance: Record<string, SourceFact[]> = {
    operating_score: [
      { label: "Revenue component (40%)",     value: `${breakdown.revScore.toFixed(1)}/100` },
      { label: "Labour component (25%)",      value: `${breakdown.labScore.toFixed(1)}/100` },
      { label: "Service component (15%)",     value: "75/100 (neutral — live score from Co-Pilot)" },
      { label: "Compliance component (10%)",  value: `${breakdown.compScore.toFixed(1)}/100` },
      { label: "Maintenance component (10%)", value: `${breakdown.maintScore.toFixed(1)}/100` },
    ],
    revenue_target: [
      {
        label:  "Target source",
        value:  revenueTarget > 0 ? `R ${revenueTarget.toLocaleString()}` : "Not set",
        detail: targetResult.estimated
          ? `Estimated: ${targetResult.warning ?? "capacity-based estimate"}`
          : targetResult.source === "sales_targets"
            ? "From sales_targets table (explicit budget)"
            : "No target configured",
      },
    ],
    labour_pct: [
      { label: "Formula",      value: "labour_cost ÷ net_sales × 100" },
      { label: "Labour cost",  value: `R ${labourCost.toLocaleString()}` },
      { label: "Net sales",    value: `R ${salesNetVat.toLocaleString()}` },
      { label: "Target",       value: `${targetLabourPct}%`,
        detail: "Set on store.target_labour_pct" },
    ],
  };

  return {
    store,
    as_of_date:           date,
    sales_net_vat:        salesNetVat,
    revenue_target:       revenueTarget,
    revenue_gap_pct:      revenueGapPct,
    revenue_gap_abs:      revenueGapAbs,
    labour_cost:          labourCost,
    labour_pct:           labourPct,
    operating_score:      score,
    score_grade:          gradeFromScore(score),
    risk_level:           riskFromScore(score),
    compliance_overdue:   complianceOverdue,
    compliance_due_soon:  complianceDueSoon,
    maintenance_critical: maintenanceCritical,
    maintenance_repeat:   maintenanceRepeat,
    actions_open:         actionsOpen,
    actions_overdue:      actionsOverdue,
    actions_completion_pct: actionsCompletionPct,
    provenance,
  };
}
