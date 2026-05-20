/**
 * Decision Engine — Alert Orchestrator
 *
 * generateOperationalAlerts(storeId, date)
 *   → Evaluates all rules against the store's current canonical data.
 *   → Deduplicates (skips if unresolved alert of same type < 24 h).
 *   → Persists new alerts to the alerts table.
 *   → Returns list of newly created alerts.
 *
 * This replaces / supplements the legacy services/alerts/engine.ts.
 * The legacy engine still runs for the primary store; this engine
 * adds multi-store + canonically-typed support.
 */

import { createServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/auditLog";
import {
  ruleRevenueBelowThreshold,
  ruleLabourAboveThreshold,
  ruleComplianceOverdue,
  ruleComplianceDueSoon,
  ruleMaintenanceOverdue,
  ruleRepeatAssetFailure,
  ruleActionPastDue,
  type AlertPayload,
  type ComplianceItemInput,
  type MaintenanceItemInput,
} from "./rules";

const DEDUP_WINDOW_HOURS = 24;
const COMPLIANCE_DUE_SOON_DAYS = 14;

// ── Main function ──────────────────────────────────────────────────────────────

export async function generateOperationalAlerts(
  storeId: string,
  date:    string   // ISO date
): Promise<string[]> {  // returns IDs of inserted alerts
  const supabase   = createServerClient();
  const created: string[] = [];

  // ── Fetch all required data in parallel ────────────────────────────────────
  const [storeRes, revRes, labourRes, snapRes, compRes, maintRes, actionsRes] =
    await Promise.all([
      supabase.from("sites").select("name, target_labour_pct").eq("id", storeId).single(),

      supabase.from("revenue_records")
        .select("net_vat_excl, net_sales")
        .eq("site_id", storeId)
        .eq("service_date", date),

      supabase.from("labour_records")
        .select("labour_cost")
        .eq("site_id", storeId)
        .eq("service_date", date),

      supabase.from("store_snapshots")
        .select("revenue_target")
        .eq("site_id", storeId)
        .lte("snapshot_date", date)
        .order("snapshot_date", { ascending: false })
        .limit(1),

      supabase.from("compliance_items")
        .select("id, title, category, next_due, status, is_critical")
        .eq("site_id", storeId)
        .eq("is_active", true)
        .in("status", ["overdue", "due_soon"]),

      supabase.from("maintenance_tickets")
        .select("id, title, priority, reported_at, due_at, recurrence_count, asset_id")
        .eq("site_id", storeId)
        .not("status", "in", '("resolved","closed")'),

      supabase.from("actions")
        .select("id, title, due_at, impact_weight")
        .eq("site_id", storeId)
        .not("status", "in", '("completed","cancelled","archived")')
        .lt("due_at", new Date().toISOString()),
    ]);

  const store      = storeRes.data as { name: string; target_labour_pct: number | null } | null;
  const storeLabel = store?.name ?? storeId;

  // ── Revenue rule ───────────────────────────────────────────────────────────
  const salesNetVat = (revRes.data ?? []).reduce(
    (s: number, r: any) => s + (r.net_vat_excl ?? r.net_sales ?? 0), 0
  );
  const revenueTarget = (snapRes.data?.[0] as any)?.revenue_target
    ? Number((snapRes.data![0] as any).revenue_target)
    : 0;

  const revAlert = ruleRevenueBelowThreshold({
    salesNetVat,
    revenueTarget,
    storeLabel,
    targetSource: "store_snapshots.revenue_target (most recent for date)",
  });
  if (revAlert) {
    const id = await persistAlert(supabase, storeId, revAlert);
    if (id) created.push(id);
  }

  // ── Labour rule ────────────────────────────────────────────────────────────
  const labourCost = (labourRes.data ?? []).reduce((s: number, r: any) => s + (r.labour_cost ?? 0), 0);
  const labourPct  = salesNetVat > 0 ? labourCost / salesNetVat * 100 : null;
  if (labourPct != null) {
    const labAlert = ruleLabourAboveThreshold({
      labourPct,
      targetPct:  store?.target_labour_pct ?? 30,
      storeLabel,
    });
    if (labAlert) {
      const id = await persistAlert(supabase, storeId, labAlert);
      if (id) created.push(id);
    }
  }

  // ── Compliance rules ───────────────────────────────────────────────────────
  const today      = new Date(date);
  for (const item of compRes.data ?? []) {
    const dueDate = new Date((item as any).next_due);
    const diffMs  = today.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);

    if ((item as any).status === "overdue") {
      const ci: ComplianceItemInput = {
        id:           (item as any).id,
        title:        (item as any).title,
        category:     (item as any).category,
        next_due:     (item as any).next_due,
        days_overdue: Math.max(0, diffDays),
        is_critical:  (item as any).is_critical,
      };
      const al = ruleComplianceOverdue(ci, storeLabel);
      const id = await persistAlert(supabase, storeId, al, (item as any).id);
      if (id) created.push(id);

    } else if ((item as any).status === "due_soon") {
      const daysUntil = Math.abs(diffDays);
      if (daysUntil <= COMPLIANCE_DUE_SOON_DAYS) {
        const al = ruleComplianceDueSoon(
          { ...item as any, days_until: daysUntil },
          storeLabel
        );
        const id = await persistAlert(supabase, storeId, al, (item as any).id);
        if (id) created.push(id);
      }
    }
  }

  // ── Maintenance rules ──────────────────────────────────────────────────────
  for (const ticket of maintRes.data ?? []) {
    const mi: MaintenanceItemInput = {
      id:               (ticket as any).id,
      title:            (ticket as any).title,
      asset_name:       (ticket as any).asset_name ?? null,
      priority:         (ticket as any).priority,
      reported_at:      (ticket as any).reported_at,
      due_at:           (ticket as any).due_at,
      recurrence_count: (ticket as any).recurrence_count ?? 0,
    };

    const overdueAlert = ruleMaintenanceOverdue(mi, storeLabel);
    if (overdueAlert) {
      const id = await persistAlert(supabase, storeId, overdueAlert, (ticket as any).id);
      if (id) created.push(id);
    }

    const repeatAlert = ruleRepeatAssetFailure(mi, storeLabel);
    if (repeatAlert) {
      const id = await persistAlert(supabase, storeId, repeatAlert, (ticket as any).id);
      if (id) created.push(id);
    }
  }

  // ── Action overdue rules ───────────────────────────────────────────────────
  for (const action of actionsRes.data ?? []) {
    if (!(action as any).due_at) continue;
    const al = ruleActionPastDue({
      actionId:   (action as any).id,
      title:      (action as any).title,
      due_at:     (action as any).due_at,
      storeLabel,
      impact:     (action as any).impact_weight ?? 1,
    });
    const id = await persistAlert(supabase, storeId, al, (action as any).id);
    if (id) created.push(id);
  }

  return created;
}

// ── Persistence helper ─────────────────────────────────────────────────────────

async function persistAlert(
  supabase:   ReturnType<typeof createServerClient>,
  storeId:    string,
  payload:    AlertPayload,
  entityRef?: string   // optional FK to the source entity
): Promise<string | null> {
  const dedupCutoff = new Date(
    Date.now() - DEDUP_WINDOW_HOURS * 3_600_000
  ).toISOString();

  // Dedup: skip if same type + unresolved within window
  const { data: existing } = await (supabase as any)
    .from("alerts")
    .select("id")
    .eq("alert_type", payload.alert_type)
    .eq("resolved", false)
    .gte("created_at", dedupCutoff)
    .limit(1)
    .maybeSingle();

  if (existing) return null;

  const { data, error } = await (supabase as any)
    .from("alerts")
    .insert({
      alert_type:      payload.alert_type,
      severity:        payload.severity,
      message:         payload.message,
      recommendation:  payload.recommendation,
      location:        storeId,
      resolved:        false,
      source_facts:    payload.source_facts,
      escalation_path: payload.escalation_path,
    })
    .select("id")
    .single();

  if (error || !data) return null;

  await writeAuditLog({
    entityType: "alert",
    entityId:   data.id,
    operation:  "create",
    actorLabel: "system:decision_engine",
    siteId:     storeId,
    afterState: {
      alert_type: payload.alert_type,
      severity:   payload.severity,
      entity_ref: entityRef,
    },
  });

  return data.id;
}
