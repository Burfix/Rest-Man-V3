/**
 * Escalation Engine
 *
 * evaluateEscalations(input) → EscalationResult[]
 *
 * Rules:
 *  - Revenue gap > 30% and no action in 60 min → escalate to operations manager
 *  - Critical action unresolved > 120 min → auto escalate
 *  - Labour overspend > 10% above target with no correction → escalate
 *  - Compliance item expired > 24h with no action → escalate to compliance team
 *  - Service-blocking maintenance open > 4h → escalate to facilities
 */

import type { EscalationResult } from "./types";

interface ActionForEscalation {
  id: string;
  title: string;
  category: string;
  severity: string;
  created_at: string;
  status: string;
  owner?: string | null;
  escalated_at?: string | null;
}

export interface EscalationInput {
  revenueGapPercent: number;
  labourOverspendPercent: number;
  complianceExpiredCount: number;
  serviceBlockingMaintenance: boolean;
  maintenanceOpenHours: number;
  pendingActions: ActionForEscalation[];
  nowISO: string;
}

function minutesSince(dateStr: string, nowISO: string): number {
  const created = new Date(dateStr).getTime();
  const now = new Date(nowISO).getTime();
  return Math.max(0, (now - created) / (1000 * 60));
}

export function evaluateEscalations(input: EscalationInput): EscalationResult[] {
  const results: EscalationResult[] = [];
  const {
    revenueGapPercent, labourOverspendPercent,
    complianceExpiredCount, serviceBlockingMaintenance,
    maintenanceOpenHours, pendingActions, nowISO,
  } = input;

  // ── Revenue gap unaddressed ──────────────────────────────────────────
  if (revenueGapPercent > 30) {
    const revenueActions = pendingActions.filter(
      a => a.category === "revenue" && a.status !== "completed"
    );
    const oldest = revenueActions[0];
    if (!oldest || minutesSince(oldest.created_at, nowISO) > 60) {
      results.push({
        actionId: oldest?.id ?? null,
        escalatedTo: { role: "operations_manager", name: null },
        reason: `Revenue ${revenueGapPercent.toFixed(0)}% behind target with no corrective action in the last hour`,
        escalatedAt: nowISO,
      });
    }
  }

  // ── Critical actions unresolved ──────────────────────────────────────
  for (const action of pendingActions) {
    if (
      action.severity === "critical" &&
      action.status !== "completed" &&
      !action.escalated_at &&
      minutesSince(action.created_at, nowISO) > 120
    ) {
      results.push({
        actionId: action.id,
        escalatedTo: { role: "operations_manager", name: null },
        reason: `Critical action "${action.title}" unresolved for over 2 hours`,
        escalatedAt: nowISO,
      });
    }
  }

  // ── Labour overspend ─────────────────────────────────────────────────
  if (labourOverspendPercent > 10) {
    const labourActions = pendingActions.filter(
      a => a.category === "labour" && a.status !== "completed"
    );
    if (labourActions.length === 0) {
      results.push({
        actionId: null,
        escalatedTo: { role: "operations_manager", name: null },
        reason: `Labour ${labourOverspendPercent.toFixed(0)}% over target with no active correction`,
        escalatedAt: nowISO,
      });
    }
  }

  // ── Compliance expired ───────────────────────────────────────────────
  if (complianceExpiredCount > 0) {
    const complianceActions = pendingActions.filter(
      a => a.category === "compliance" && a.severity === "critical"
    );
    const unresolved = complianceActions.filter(a => a.status !== "completed");
    if (unresolved.length > 0 || complianceExpiredCount > 0) {
      results.push({
        actionId: unresolved[0]?.id ?? null,
        escalatedTo: { role: "compliance_team", name: null },
        reason: `${complianceExpiredCount} compliance item${complianceExpiredCount > 1 ? "s" : ""} expired without resolution`,
        escalatedAt: nowISO,
      });
    }
  }

  // ── Service-blocking maintenance ─────────────────────────────────────
  if (serviceBlockingMaintenance && maintenanceOpenHours > 4) {
    results.push({
      actionId: null,
      escalatedTo: { role: "facilities_manager", name: null },
      reason: `Service-blocking maintenance issue open for ${maintenanceOpenHours.toFixed(0)} hours`,
      escalatedAt: nowISO,
    });
  }

  return results;
}
