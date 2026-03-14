/**
 * Maintenance & equipment summary service.
 */

import { createServerClient } from "@/lib/supabase/server";
import { Equipment, EquipmentRepair, MaintenanceLog, MaintenanceSummary } from "@/types";

const OPEN_STATUSES = ["open", "in_progress", "awaiting_parts"] as const;

export async function getMaintenanceSummary(): Promise<MaintenanceSummary> {
  const supabase = createServerClient();

  const [equipResult, openResult] = await Promise.all([
    supabase.from("equipment").select("id, status"),
    supabase
      .from("maintenance_logs")
      .select("*")
      .in("repair_status", [...OPEN_STATUSES])
      .order("date_reported", { ascending: false }),
  ]);

  if (equipResult.error) {
    throw new Error(`[OpsSvc/Maintenance] Equipment: ${equipResult.error.message}`);
  }
  if (openResult.error) {
    throw new Error(`[OpsSvc/Maintenance] Logs: ${openResult.error.message}`);
  }

  const equipment = (equipResult.data ?? []) as Pick<Equipment, "id" | "status">[];
  const openIssues = (openResult.data ?? []) as MaintenanceLog[];

  return {
    totalEquipment: equipment.length,
    openRepairs: openIssues.filter((l) => l.repair_status === "open").length,
    inProgress: openIssues.filter((l) => l.repair_status === "in_progress").length,
    awaitingParts: openIssues.filter((l) => l.repair_status === "awaiting_parts").length,
    outOfService: equipment.filter((e) => e.status === "out_of_service").length,
    urgentIssues: openIssues.filter(
      (l) => l.priority === "urgent" || l.priority === "high"
    ),
  };
}

/** Full equipment list for /dashboard/maintenance */
export async function getAllEquipment(): Promise<Equipment[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("equipment")
    .select("*")
    .order("category", { ascending: true })
    .order("unit_name", { ascending: true });

  if (error) {
    throw new Error(`[OpsSvc/Maintenance] ${error.message}`);
  }

  return (data ?? []) as Equipment[];
}

/** Full maintenance log for /dashboard/maintenance */
export async function getAllMaintenanceLogs(options?: {
  openOnly?: boolean;
  limit?: number;
}): Promise<MaintenanceLog[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("maintenance_logs")
    .select("*")
    .order("date_reported", { ascending: false });

  if (options?.openOnly) {
    query = query.in("repair_status", [...OPEN_STATUSES]);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`[OpsSvc/Maintenance] ${error.message}`);
  }

  return (data ?? []) as MaintenanceLog[];
}

// ── Equipment detail (with repairs) ──────────────────────────────────────────

export async function getEquipmentById(id: string): Promise<Equipment | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("equipment")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Equipment;
}

export async function getRepairsByEquipmentId(equipmentId: string): Promise<EquipmentRepair[]> {
  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("equipment_repairs")
    .select("*")
    .eq("equipment_id", equipmentId)
    .order("repair_date", { ascending: false });
  if (error) throw new Error(`[OpsSvc/Maintenance] ${error.message}`);
  return (data ?? []) as EquipmentRepair[];
}

export async function createRepair(
  equipmentId: string,
  payload: Omit<EquipmentRepair, "id" | "equipment_id" | "created_at">
): Promise<EquipmentRepair> {
  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("equipment_repairs")
    .insert({ equipment_id: equipmentId, ...payload })
    .select()
    .single();
  if (error) throw new Error(`[OpsSvc/Maintenance] ${error.message}`);
  return data as EquipmentRepair;
}

// ── Upcoming services across all equipment ────────────────────────────────────

export interface UpcomingService {
  equipment_id: string;
  unit_name: string;
  next_service_due: string;
  days_until_service: number;
}

export async function getUpcomingServices(withinDays = 30): Promise<UpcomingService[]> {
  const supabase = createServerClient();
  const today = new Date().toISOString().split("T")[0];
  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().split("T")[0];

  // Latest repair per equipment that has a next_service_due
  const { data, error } = await (supabase as any)
    .from("equipment_repairs")
    .select("equipment_id, next_service_due, equipment:equipment_id(unit_name)")
    .gte("next_service_due", today)
    .lte("next_service_due", cutoff)
    .order("next_service_due", { ascending: true });

  if (error) return [];

  // Deduplicate: keep earliest upcoming per equipment
  const seen = new Set<string>();
  const results: UpcomingService[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.equipment_id)) continue;
    seen.add(row.equipment_id);
    const unit_name = (row.equipment as any)?.unit_name ?? "Unknown";
    const days = Math.ceil(
      (new Date(row.next_service_due).getTime() - Date.now()) / 86400000
    );
    results.push({
      equipment_id: row.equipment_id,
      unit_name,
      next_service_due: row.next_service_due,
      days_until_service: days,
    });
  }
  return results;
}

// ── Warranty monitoring ────────────────────────────────────────────────────

export interface ExpiringWarranty {
  equipment_id: string;
  unit_name: string;
  warranty_expiry: string;
  days_until_expiry: number;
  expired: boolean;
}

export async function getExpiringWarranties(withinDays = 60): Promise<ExpiringWarranty[]> {
  const supabase = createServerClient();
  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().split("T")[0];

  const { data, error } = await (supabase as any)
    .from("equipment")
    .select("id, unit_name, warranty_expiry")
    .not("warranty_expiry", "is", null)
    .lte("warranty_expiry", cutoff)
    .order("warranty_expiry", { ascending: true });

  if (error) return [];

  return (data ?? []).map((row: { id: string; unit_name: string; warranty_expiry: string }) => {
    const days = Math.ceil(
      (new Date(row.warranty_expiry).getTime() - Date.now()) / 86400000
    );
    return {
      equipment_id: row.id,
      unit_name: row.unit_name,
      warranty_expiry: row.warranty_expiry,
      days_until_expiry: days,
      expired: days < 0,
    };
  });
}

// ── Maintenance risk score ────────────────────────────────────────────────────

export interface MaintenanceRiskScore {
  total: number;
  operational: number;
  needs_attention: number;
  out_of_service: number;
  risk_pct: number; // 0–100
}

export async function getMaintenanceRiskScore(): Promise<MaintenanceRiskScore> {
  const supabase = createServerClient();
  const { data } = await supabase.from("equipment").select("status");
  const rows = data ?? [];
  const operational = rows.filter((r) => r.status === "operational").length;
  const needs_attention = rows.filter((r) => r.status === "needs_attention").length;
  const out_of_service = rows.filter((r) => r.status === "out_of_service").length;
  const total = rows.length;
  const risk_pct = total === 0 ? 0 : Math.round(((needs_attention + out_of_service * 2) / (total * 2)) * 100);
  return { total, operational, needs_attention, out_of_service, risk_pct };
}
