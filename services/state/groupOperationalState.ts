/**
 * Group Operational State Engine
 *
 * Aggregates StoreOperationalState across all active stores
 * within an organisation for a given date.
 *
 * getGroupOperationalState(orgId, date) → GroupOperationalState
 */

import { createServerClient } from "@/lib/supabase/server";
import { getStoreOperationalState } from "@/services/state/storeOperationalState";
import type { GroupOperationalState } from "@/lib/ontology/entities";

export async function getGroupOperationalState(
  orgId: string,
  date:  string   // ISO date "YYYY-MM-DD"
): Promise<GroupOperationalState> {
  const supabase = createServerClient();

  // Fetch all active stores for this organisation
  const { data: storeRows, error } = await supabase
    .from("sites")
    .select("id, name")
    .eq("organisation_id", orgId)
    .eq("is_active", true);

  if (error) throw new Error(`[GroupState] Could not fetch stores: ${error.message}`);
  if (!storeRows || storeRows.length === 0) {
    // No stores — return empty group state
    const { data: orgRow } = await supabase
      .from("organisations")
      .select("name")
      .eq("id", orgId)
      .single();

    return {
      organisation_id:          orgId,
      org_name:                 (orgRow as any)?.name ?? orgId,
      as_of_date:               date,
      store_count:              0,
      total_revenue:            0,
      total_target:             0,
      group_revenue_gap_pct:    null,
      avg_labour_pct:           null,
      avg_operating_score:      null,
      total_compliance_overdue: 0,
      total_maintenance_critical: 0,
      total_repeat_failures:    0,
      red_stores:               0,
      yellow_stores:            0,
      green_stores:             0,
      stores:                   [],
    };
  }

  // Compute state for all stores in parallel (bounded by store count ≈ 5–20)
  const stateResults = await Promise.allSettled(
    storeRows.map((s: any) => getStoreOperationalState(s.id, date))
  );

  const stores = stateResults
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getStoreOperationalState>>> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value);

  // Aggregate
  const totalRevenue  = stores.reduce((s, x) => s + x.sales_net_vat, 0);
  const totalTarget   = stores.reduce((s, x) => s + x.revenue_target, 0);
  const withLabour    = stores.filter((x) => x.labour_pct != null);
  const withScore     = stores.filter((x) => x.operating_score != null);

  // Fetch org name
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", orgId)
    .single();

  return {
    organisation_id:          orgId,
    org_name:                 (orgRow as any)?.name ?? orgId,
    as_of_date:               date,
    store_count:              stores.length,
    total_revenue:            totalRevenue,
    total_target:             totalTarget,
    group_revenue_gap_pct:    totalTarget > 0
      ? +((totalRevenue - totalTarget) / totalTarget * 100).toFixed(2)
      : null,
    avg_labour_pct:           withLabour.length > 0
      ? +(withLabour.reduce((s, x) => s + (x.labour_pct ?? 0), 0) / withLabour.length).toFixed(2)
      : null,
    avg_operating_score:      withScore.length > 0
      ? Math.round(withScore.reduce((s, x) => s + x.operating_score, 0) / withScore.length)
      : null,
    total_compliance_overdue: stores.reduce((s, x) => s + x.compliance_overdue, 0),
    total_maintenance_critical: stores.reduce((s, x) => s + x.maintenance_critical, 0),
    total_repeat_failures:    stores.reduce((s, x) => s + x.maintenance_repeat, 0),
    red_stores:    stores.filter((x) => x.risk_level === "red").length,
    yellow_stores: stores.filter((x) => x.risk_level === "yellow").length,
    green_stores:  stores.filter((x) => x.risk_level === "green").length,
    stores,
  };
}
