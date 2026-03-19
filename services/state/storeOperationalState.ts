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
import type {
  StoreOperationalState,
  Store,
  ScoreGrade,
  RiskLevel,
  SourceFact,
} from "@/lib/ontology/entities";

// ── Score computation ─────────────────────────────────────────────────────────

function gradeFromScore(score: number): ScoreGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

function riskFromScore(score: number): RiskLevel {
  if (score >= 70) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

/**
 * Weighted operating score:
 *   40% — Revenue attainment      (0–100)
 *   25% — Labour efficiency       (0–100, inverted above target)
 *   20% — Compliance              (0–100, penalised for overdue)
 *   15% — Maintenance             (0–100, penalised for critical tickets)
 */
function computeOperatingScore(params: {
  revenueActual:         number;
  revenueTarget:         number;
  labourPct:             number | null;
  targetLabourPct:       number;
  complianceOverdue:     number;
  complianceDueSoon:     number;
  maintenanceCritical:   number;
  maintenanceRepeat:     number;
}): { score: number; breakdown: Record<string, number> } {
  const {
    revenueActual, revenueTarget, labourPct, targetLabourPct,
    complianceOverdue, complianceDueSoon,
    maintenanceCritical, maintenanceRepeat,
  } = params;

  // Revenue component (0–100)
  const revScore = revenueTarget > 0
    ? Math.min(100, Math.max(0, (revenueActual / revenueTarget) * 100))
    : 50;

  // Labour component (0–100): 100 = at or below target; penalise over-target
  const labScore = labourPct != null
    ? Math.min(100, Math.max(0, 100 - Math.max(0, labourPct - targetLabourPct) * 3))
    : 50;

  // Compliance component (0–100): each overdue −15, each due-soon −5
  const compScore = Math.min(100, Math.max(0,
    100 - complianceOverdue * 15 - complianceDueSoon * 5
  ));

  // Maintenance component (0–100): each critical −20, each repeat −10
  const maintScore = Math.min(100, Math.max(0,
    100 - maintenanceCritical * 20 - maintenanceRepeat * 10
  ));

  const score = Math.round(
    revScore  * 0.40 +
    labScore  * 0.25 +
    compScore * 0.20 +
    maintScore * 0.15
  );

  return {
    score,
    breakdown: { revScore, labScore, compScore, maintScore },
  };
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

      supabase.from("store_snapshots")
        .select("revenue_target")
        .eq("site_id", storeId)
        .lte("snapshot_date", date)
        .order("snapshot_date", { ascending: false })
        .limit(1),

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
  const snapshots     = snapRes.data ?? [];
  const actionRows    = actionsRes.data ?? [];

  // ── Revenue ────────────────────────────────────────────────────────────────
  const salesNetVat = revRows.reduce(
    (sum, r) => sum + (r.net_vat_excl ?? r.net_sales ?? 0), 0
  );
  const revenueTarget = (snapshots[0] as any)?.revenue_target
    ? Number((snapshots[0] as any).revenue_target)
    : 0;
  const revenueGapAbs = revenueTarget > 0 ? salesNetVat - revenueTarget : null;
  const revenueGapPct = revenueTarget > 0
    ? +((salesNetVat - revenueTarget) / revenueTarget * 100).toFixed(2)
    : null;

  // ── Labour ─────────────────────────────────────────────────────────────────
  const labourCost = labourRows.reduce((sum, r) => sum + (r.labour_cost ?? 0), 0);
  const labourPct  = salesNetVat > 0
    ? +(labourCost / salesNetVat * 100).toFixed(2)
    : null;
  const targetLabourPct = store.target_labour_pct ?? 30;

  // ── Compliance ─────────────────────────────────────────────────────────────
  const complianceOverdue  = compItems.filter((c: any) => c.status === "overdue").length;
  const complianceDueSoon  = compItems.filter((c: any) => c.status === "due_soon").length;

  // ── Maintenance ────────────────────────────────────────────────────────────
  const maintenanceCritical = maintTickets.filter(
    (t: any) => t.priority === "critical" || t.priority === "high"
  ).length;
  const maintenanceRepeat = maintTickets.filter((t: any) => t.recurrence_count > 1).length;

  // ── Operating score ────────────────────────────────────────────────────────
  const { score, breakdown } = computeOperatingScore({
    revenueActual:   salesNetVat,
    revenueTarget,
    labourPct,
    targetLabourPct,
    complianceOverdue,
    complianceDueSoon,
    maintenanceCritical,
    maintenanceRepeat,
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
      { label: "Revenue component (40%)",    value: `${breakdown.revScore.toFixed(1)}/100` },
      { label: "Labour component (25%)",     value: `${breakdown.labScore.toFixed(1)}/100` },
      { label: "Compliance component (20%)", value: `${breakdown.compScore.toFixed(1)}/100` },
      { label: "Maintenance component (15%)",value: `${breakdown.maintScore.toFixed(1)}/100` },
    ],
    revenue_target: [
      {
        label:  "Target source",
        value:  revenueTarget > 0 ? `R ${revenueTarget.toLocaleString()}` : "Not set",
        detail: "Based on most recent store_snapshots record for this date",
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
