// ──────────────────────────────────────────────────────────────────────────────
// Universal Operational Data Model — TypeScript Types
// These types mirror the tables introduced in migrations 012 & 013.
// ──────────────────────────────────────────────────────────────────────────────

// ── Primitive enums ───────────────────────────────────────────────────────────

export type SiteType =
  | "restaurant"
  | "airport"
  | "mall"
  | "hotel"
  | "petrol_station"
  | "office"
  | "other";

export type ZoneType =
  | "kitchen"
  | "bar"
  | "dining_room"
  | "terrace"
  | "bathrooms"
  | "entrance"
  | "storage"
  | "office"
  | "general";

export type AssetType =
  | "equipment"
  | "vehicle"
  | "fixture"
  | "system"
  | "infrastructure";

export type ObligationType =
  | "compliance"
  | "maintenance"
  | "operational"
  | "safety"
  | "audit";

export type ObligationStatus = "compliant" | "due_soon" | "overdue" | "unknown";
export type ObligationRecurrence =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "once"
  | "ad_hoc";

export type TicketType =
  | "maintenance"
  | "escalation"
  | "reputation"
  | "operational"
  | "safety";

export type DocumentType =
  | "certificate"
  | "invoice"
  | "photo"
  | "report"
  | "audit"
  | "general";

export type WorkflowAction =
  | "created"
  | "status_changed"
  | "assigned"
  | "commented"
  | "resolved"
  | "closed"
  | "escalated"
  | "document_attached";

export type ServiceType =
  | "repair"
  | "service"
  | "inspection"
  | "replacement"
  | "commissioning";

// ── Risk / heatmap ────────────────────────────────────────────────────────────

export type ZoneRiskStatus = "green" | "amber" | "red";
export type Priority = "critical" | "high" | "medium" | "low";

// ── Core tables ───────────────────────────────────────────────────────────────

export interface Site {
  id: string;
  name: string;
  site_type: SiteType;
  address: string | null;
  city: string | null;
  country: string;
  timezone: string;
  is_active: boolean;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: string;
  site_id: string;
  name: string;
  zone_type: ZoneType;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contractor {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  specialisation: string[] | null;
  is_preferred: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Obligation {
  id: string;
  site_id: string;
  zone_id: string | null;
  asset_id: string | null;
  label: string;
  obligation_type: ObligationType;
  compliance_item_id: string | null;
  recurrence: ObligationRecurrence;
  status: ObligationStatus;
  last_completed_at: string | null;   // date string yyyy-mm-dd
  next_due_at: string | null;         // date string yyyy-mm-dd
  responsible_party: string | null;
  priority: Priority;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowLog {
  id: string;
  entity_type: string;    // 'obligation' | 'ticket' | 'asset' | 'document' | ...
  entity_id: string;
  site_id: string | null;
  action: WorkflowAction;
  from_value: string | null;
  to_value: string | null;
  triggered_by: string | null;   // user email or 'system' or 'cron'
  channel: string | null;        // 'dashboard' | 'api' | 'whatsapp' | 'cron'
  notes: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  site_id: string;
  document_type: DocumentType;
  obligation_id: string | null;
  asset_id: string | null;
  ticket_id: string | null;
  compliance_doc_id: string | null;
  file_name: string;
  file_url: string;
  file_size: number | null;
  uploaded_by: string | null;
  notes: string | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

// ── Risk & heatmap ────────────────────────────────────────────────────────────

export interface RiskScore {
  id: string;
  site_id: string;
  zone_id: string | null;       // null = site-level roll-up
  ticket_score: number;
  obligation_score: number;
  asset_score: number;
  event_conflict_score: number;
  composite_score: number;
  status: ZoneRiskStatus;
  open_ticket_count: number;
  overdue_obligation_count: number;
  oos_asset_count: number;
  active_event_count: number;
  computed_at: string;
}

export interface ZoneSnapshot {
  id: string;
  site_id: string;
  zone_id: string | null;
  zone_name: string;
  status: ZoneRiskStatus;
  composite_score: number;
  primary_risk: string | null;
  secondary_risk: string | null;
  ticket_count: number;
  obligation_count: number;
  oos_count: number;
  snapped_at: string;
}

export interface AssetServiceHistory {
  id: string;
  asset_id: string;
  site_id: string;
  service_type: ServiceType;
  service_date: string;         // date string yyyy-mm-dd
  description: string | null;
  performed_by: string | null;
  contractor_id: string | null;
  cost: number | null;
  next_service_due: string | null;
  document_url: string | null;
  equipment_repair_id: string | null;
  maintenance_log_id: string | null;
  created_at: string;
}

// ── Aggregated view types (for service layer) ─────────────────────────────────

/** Lightweight universal ticket projection of a maintenance_logs row */
export interface UniversalTicket {
  id: string;
  site_id: string | null;
  zone_id: string | null;
  asset_id: string | null;
  ticket_type: TicketType;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assigned_to: string | null;
  opened_at: string;
  resolved_at: string | null;
  // Enriched by service layer:
  zone_name?: string | null;
  asset_name?: string | null;
}

/** Full zone heatmap summary — one per zone, assembled by zoneSummary service */
export interface ZoneSummary {
  zone: Zone;
  status: ZoneRiskStatus;
  composite_score: number;
  open_tickets: number;
  critical_tickets: number;
  overdue_obligations: number;
  due_soon_obligations: number;
  oos_assets: number;
  active_event_conflicts: number;
  primary_risk: string | null;
  secondary_risk?: string | null;
  last_computed_at: string | null;
}

/** Site-level aggregation for the command centre header */
export interface SiteSummary {
  site: Site;
  overall_status: ZoneRiskStatus;
  zone_summaries: ZoneSummary[];
  total_open_tickets: number;
  total_overdue_obligations: number;
  total_oos_assets: number;
  computed_at: string;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

// DEFAULT_SITE_ID removed — callers must derive siteId from getUserContext().
// Fallbacks to a hardcoded site UUID create cross-tenant data leaks.
