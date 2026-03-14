/**
 * Universal Operational Data Model — Adapter / Mapping Layer
 *
 * Bridges the restaurant-specific tables (maintenance_logs, compliance_items,
 * equipment, etc.) into the universal engine types (UniversalTicket, Obligation,
 * WorkflowLog, etc.).
 *
 * The existing service layer (services/ops/, services/bookings/) is UNCHANGED.
 * This adapter provides a second query path used by the risk engine and zone
 * heatmap — it does not replace the existing paths.
 */

import { createServerClient } from "@/lib/supabase/server";
import type {
  Site,
  Zone,
  Obligation,
  Contractor,
  WorkflowLog,
  WorkflowAction,
  UniversalTicket,
} from "@/types/universal";

// ── Sites ─────────────────────────────────────────────────────────────────────

export async function getSiteById(siteId: string): Promise<Site | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", siteId)
    .single();

  if (error) {
    console.error("[universal/adapter] getSiteById:", error.message);
    return null;
  }
  return data as Site;
}

export async function getActiveSites(): Promise<Site[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("[universal/adapter] getActiveSites:", error.message);
    return [];
  }
  return (data ?? []) as Site[];
}

// ── Zones ─────────────────────────────────────────────────────────────────────

export async function getZonesForSite(siteId: string): Promise<Zone[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("zones")
    .select("*")
    .eq("site_id", siteId)
    .eq("is_active", true)
    .order("display_order");

  if (error) {
    console.error("[universal/adapter] getZonesForSite:", error.message);
    return [];
  }
  return (data ?? []) as Zone[];
}

export async function getZoneById(zoneId: string): Promise<Zone | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("zones")
    .select("*")
    .eq("id", zoneId)
    .single();

  if (error) {
    console.error("[universal/adapter] getZoneById:", error.message);
    return null;
  }
  return data as Zone;
}

// ── Obligations ───────────────────────────────────────────────────────────────

export async function getObligationsForSite(
  siteId: string,
  opts: { zoneId?: string; types?: string[]; statuses?: string[] } = {}
): Promise<Obligation[]> {
  const supabase = createServerClient();
  let query = supabase
    .from("obligations")
    .select("*")
    .eq("site_id", siteId)
    .eq("is_active", true);

  if (opts.zoneId) query = query.eq("zone_id", opts.zoneId);
  if (opts.types?.length) query = query.in("obligation_type", opts.types);
  if (opts.statuses?.length) query = query.in("status", opts.statuses);

  query = query.order("next_due_at", { nullsFirst: false });

  const { data, error } = await query;
  if (error) {
    console.error("[universal/adapter] getObligationsForSite:", error.message);
    return [];
  }
  return (data ?? []) as Obligation[];
}

/** Returns obligations whose next_due_at is in the past (overdue) */
export async function getOverdueObligations(siteId: string): Promise<Obligation[]> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("obligations")
    .select("*")
    .eq("site_id", siteId)
    .eq("is_active", true)
    .lt("next_due_at", today)
    .order("next_due_at");

  if (error) {
    console.error("[universal/adapter] getOverdueObligations:", error.message);
    return [];
  }
  return (data ?? []) as Obligation[];
}

/** Returns obligations due within the next N days */
export async function getDueSoonObligations(
  siteId: string,
  withinDays = 14
): Promise<Obligation[]> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("obligations")
    .select("*")
    .eq("site_id", siteId)
    .eq("is_active", true)
    .gte("next_due_at", today)
    .lte("next_due_at", future)
    .order("next_due_at");

  if (error) {
    console.error("[universal/adapter] getDueSoonObligations:", error.message);
    return [];
  }
  return (data ?? []) as Obligation[];
}

// ── Tickets (universal view of maintenance_logs) ──────────────────────────────

/**
 * Returns a list of maintenance_logs rows as universal tickets.
 * Only open / in-progress tickets are returned by default.
 */
export async function getTicketsForSite(
  siteId: string,
  opts: {
    zoneId?: string;
    ticketType?: string;
    statuses?: string[];
    limit?: number;
  } = {}
): Promise<UniversalTicket[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("maintenance_logs")
    .select(
      `id, site_id, zone_id, equipment_id, ticket_type,
       issue_title, issue_description, priority,
       repair_status, date_reported, date_resolved`
    )
    .eq("site_id", siteId);

  if (opts.zoneId) query = query.eq("zone_id", opts.zoneId);
  if (opts.ticketType) query = query.eq("ticket_type", opts.ticketType);
  if (opts.statuses?.length) {
    query = query.in("repair_status", opts.statuses);
  } else {
    // Default: open + in_progress only
    query = query.in("repair_status", ["open", "in_progress"]);
  }

  if (opts.limit) query = query.limit(opts.limit);
  query = query.order("date_reported", { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error("[universal/adapter] getTicketsForSite:", error.message);
    return [];
  }

  return (data ?? []).map((row) => mapMaintenanceLogToTicket(row));
}

/** Maps a raw maintenance_logs row to the universal UniversalTicket shape */
export function mapMaintenanceLogToTicket(row: Record<string, unknown>): UniversalTicket {
  return {
    id: row.id as string,
    site_id: (row.site_id as string) ?? null,
    zone_id: (row.zone_id as string) ?? null,
    asset_id: (row.equipment_id as string) ?? null,
    ticket_type: ((row.ticket_type as string) ?? "maintenance") as UniversalTicket["ticket_type"],
    title: (row.issue_title as string) ?? "Untitled ticket",
    description: (row.issue_description as string) ?? null,
    status: (row.repair_status as string) ?? "open",
    priority: (row.priority as string) ?? null,
    assigned_to: null,
    opened_at: (row.date_reported as string) ?? new Date().toISOString(),
    resolved_at: (row.date_resolved as string) ?? null,
  };
}

// ── Contractors ───────────────────────────────────────────────────────────────

export async function getActiveContractors(): Promise<Contractor[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("contractors")
    .select("*")
    .eq("is_active", true)
    .order("is_preferred", { ascending: false });

  if (error) {
    console.error("[universal/adapter] getActiveContractors:", error.message);
    return [];
  }
  return (data ?? []) as Contractor[];
}

// ── Workflow log writer ───────────────────────────────────────────────────────

export interface LogWorkflowParams {
  entityType: string;
  entityId: string;
  siteId?: string;
  action: WorkflowAction;
  fromValue?: string | null;
  toValue?: string | null;
  triggeredBy?: string | null;
  channel?: string | null;
  notes?: string | null;
}

/**
 * Appends an audit event to workflow_logs.
 * Fire-and-forget safe — errors are logged but not thrown.
 */
export async function logWorkflowEvent(params: LogWorkflowParams): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase.from("workflow_logs").insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    site_id: params.siteId ?? null,
    action: params.action,
    from_value: params.fromValue ?? null,
    to_value: params.toValue ?? null,
    triggered_by: params.triggeredBy ?? null,
    channel: params.channel ?? "api",
    notes: params.notes ?? null,
  });

  if (error) {
    console.error("[universal/adapter] logWorkflowEvent:", error.message);
  }
}

/** Reads the last N workflow events for any entity */
export async function getWorkflowLogs(
  entityType: string,
  entityId: string,
  limit = 20
): Promise<WorkflowLog[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("workflow_logs")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[universal/adapter] getWorkflowLogs:", error.message);
    return [];
  }
  return (data ?? []) as WorkflowLog[];
}

// ── OOS asset count helper (used by risk scoring) ─────────────────────────────

export async function getOosAssetCount(
  siteId: string,
  zoneId?: string
): Promise<number> {
  const supabase = createServerClient();
  let query = supabase
    .from("equipment")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("status", "out_of_service");

  if (zoneId) query = query.eq("zone_id", zoneId);

  const { count, error } = await query;
  if (error) {
    console.error("[universal/adapter] getOosAssetCount:", error.message);
    return 0;
  }
  return count ?? 0;
}
