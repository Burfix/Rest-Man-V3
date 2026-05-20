/**
 * Ontology — Canonical entity types for the operational platform.
 *
 * This file is the single TypeScript source of truth for all business
 * entities. Service functions accept and return these types. UI
 * components consume them via page-level data fetching.
 *
 * Hierarchy:
 *   Organisation → Region → Store → ServiceDay
 *   Store → Asset → MaintenanceTicket
 *   Store → ComplianceItem → ComplianceDocument
 *   Store → Alert → Action → ActionEvent
 *   Store → Review
 *   Store → Incident
 */

// ── Primitives ─────────────────────────────────────────────────────────────────

export type RiskLevel     = "green" | "yellow" | "red";
export type ScoreGrade    = "A" | "B" | "C" | "D" | "F";
export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ActionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "overdue"
  | "cancelled"
  | "escalated"
  | "archived";

export type ActionEventType =
  | "created"
  | "assigned"
  | "started"
  | "completed"
  | "reopened"
  | "escalated"
  | "commented"
  | "due_changed";

export type MaintenanceStatus =
  | "open"
  | "in_progress"
  | "waiting_parts"
  | "resolved"
  | "closed"
  | "reopened";

export type ComplianceStatus =
  | "pending"
  | "compliant"
  | "due_soon"
  | "overdue"
  | "exempt"
  | "blocked";

export type UserRole =
  | "super_admin"
  | "executive"
  | "head_office"
  | "area_manager"
  | "gm"
  | "supervisor"
  | "contractor"
  | "auditor"
  | "viewer";

// ── Core Entities ──────────────────────────────────────────────────────────────

export interface Organisation {
  id:           string;
  name:         string;
  slug:         string;
  country:      string;
  timezone:     string;
  currency:     string;
  settings:     Record<string, unknown>;
  is_active:    boolean;
  created_at:   string;
  updated_at:   string;
}

export interface Region {
  id:               string;
  organisation_id:  string;
  name:             string;
  code:             string;
  area_manager_id:  string | null;
  is_active:        boolean;
  created_at:       string;
}

export interface Store {
  id:                 string;
  name:               string;
  city:               string | null;
  timezone:           string | null;
  store_code:         string | null;
  organisation_id:    string | null;
  region_id:          string | null;
  gm_user_id:         string | null;
  target_labour_pct:  number | null;
  target_margin_pct:  number | null;
  settings:           Record<string, unknown>;
  is_active:          boolean;
}

export interface ServiceDay {
  id:               string;
  site_id:          string;
  service_date:     string;      // ISO date
  day_of_week:      number;      // 0–6
  is_holiday:       boolean;
  event_id:         string | null;
  covers_booked:    number | null;
  covers_actual:    number | null;
  revenue_net_vat:  number | null;
  revenue_target:   number | null;
  labour_cost:      number | null;
  operating_score:  number | null;
  risk_level:       RiskLevel | null;
  notes:            string | null;
  closed_by:        string | null;
  closed_at:        string | null;
  created_at:       string;
}

export interface RevenueRecord {
  id:            string;
  site_id:       string;
  service_date:  string;
  period_label:  string | null;
  gross_sales:   number;
  discounts:     number;
  refunds:       number;
  net_sales:     number;
  vat_amount:    number | null;
  net_vat_excl:  number | null;
  covers:        number | null;
  avg_spend:     number | null;
  source:        string;
  created_at:    string;
}

export interface LabourRecord {
  id:             string;
  site_id:        string;
  service_date:   string;
  employee_id:    string | null;
  employee_name:  string | null;
  role:           string | null;
  hours_worked:   number | null;
  labour_cost:    number | null;
  department:     string | null;
  source:         string;
  created_at:     string;
}

// ── Assets & Maintenance ───────────────────────────────────────────────────────

export interface Asset {
  id:                string;
  site_id:           string;
  name:              string;
  asset_code:        string | null;
  category:          string;
  manufacturer:      string | null;
  model:             string | null;
  serial_number:     string | null;
  purchase_date:     string | null;
  warranty_expiry:   string | null;
  location_in_store: string | null;
  status:            string;
  criticality:       string;
  last_service_date: string | null;
  next_service_date: string | null;
  notes:             string | null;
  is_active:         boolean;
  created_at:        string;
  updated_at:        string;
}

export interface MaintenanceTicket {
  id:               string;
  site_id:          string;
  asset_id:         string | null;
  title:            string;
  description:      string | null;
  category:         string;
  priority:         string;
  status:           MaintenanceStatus;
  reported_by:      string | null;
  assigned_to:      string | null;
  contractor_id:    string | null;
  reported_at:      string;
  due_at:           string | null;
  resolved_at:      string | null;
  cost:             number | null;
  recurrence_count: number;
  notes:            string | null;
  created_at:       string;
  updated_at:       string;
  // joined
  asset_name?:      string;
}

export interface Contractor {
  id:              string;
  organisation_id: string | null;
  name:            string;
  company:         string | null;
  speciality:      string[];
  email:           string | null;
  phone:           string | null;
  is_approved:     boolean;
  rating:          number | null;
  created_at:      string;
}

// ── Compliance ─────────────────────────────────────────────────────────────────

export interface ComplianceItem {
  id:                string;
  site_id:           string;
  title:             string;
  category:          string;
  description:       string | null;
  frequency:         string;
  last_completed:    string | null;
  next_due:          string;
  status:            ComplianceStatus;
  responsible_id:    string | null;
  evidence_required: boolean;
  is_critical:       boolean;
  is_active:         boolean;
  created_at:        string;
  updated_at:        string;
  // derived
  days_overdue?:     number;
}

export interface ComplianceDocument {
  id:                  string;
  compliance_item_id:  string;
  site_id:             string;
  file_url:            string;
  file_name:           string;
  mime_type:           string | null;
  uploaded_by:         string | null;
  upload_date:         string;
  valid_from:          string | null;
  expires_at:          string | null;
  notes:               string | null;
}

// ── Alerts & Actions ───────────────────────────────────────────────────────────

export interface OperationalAlert {
  id:               string;
  site_id:          string;
  alert_type:       string;
  severity:         AlertSeverity;
  title:            string;
  message:          string;
  recommendation:   string;
  resolved:         boolean;
  resolved_at:      string | null;
  escalation_path:  string | null;
  /**
   * Structured provenance: what facts triggered this alert.
   * Rendered in the UI as "Why this alert?" expanded panel.
   */
  source_facts:     SourceFact[];
  created_at:       string;
}

/** A single fact that contributed to generating an alert or metric. */
export interface SourceFact {
  label:   string;   // "Revenue Gap"
  value:   string;   // "-18.4%"
  detail?: string;   // "Target derived from same weekday LY × 1.10"
}

export interface Action {
  id:               string;
  alert_id:         string | null;
  site_id:          string;
  title:            string;
  description:      string | null;
  action_type:      string;
  impact_weight:    number;    // 1–5
  assigned_to:      string | null;
  due_at:           string | null;
  status:           ActionStatus;
  expected_outcome: string | null;
  completed_at:     string | null;
  archived_at:      string | null;
  created_at:       string;
  updated_at:       string;
}

export interface ActionEvent {
  id:          string;
  action_id:   string;
  event_type:  ActionEventType;
  actor:       string | null;   // user_id or 'system'
  actor_label: string | null;
  notes:       string | null;
  created_at:  string;
}

// ── Reviews & Incidents ────────────────────────────────────────────────────────

export interface Review {
  id:             string;
  site_id:        string;
  platform:       string;
  external_id:    string | null;
  reviewer_name:  string | null;
  rating:         number;
  review_text:    string | null;
  response_text:  string | null;
  responded_at:   string | null;
  review_date:    string;
  sentiment:      string | null;
  sentiment_score: number | null;
  tags:           string[];
  created_at:     string;
}

export interface Incident {
  id:               string;
  site_id:          string;
  title:            string;
  description:      string | null;
  incident_type:    string;
  severity:         string;
  status:           string;
  occurred_at:      string;
  reported_by:      string | null;
  assigned_to:      string | null;
  resolved_at:      string | null;
  resolution_notes: string | null;
  created_at:       string;
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

export interface UserRoleRecord {
  id:              string;
  user_id:         string;
  organisation_id: string | null;
  region_id:       string | null;
  site_id:         string | null;
  role:            UserRole;
  is_active:       boolean;
  granted_by:      string | null;
  granted_at:      string;
  revoked_at:      string | null;
}

// ── Operational State ─────────────────────────────────────────────────────────
// These are the composite objects returned by the state engine.

export interface StoreOperationalState {
  store:              Store;
  as_of_date:         string;

  // Revenue
  sales_net_vat:      number;
  revenue_target:     number;
  revenue_gap_pct:    number | null;
  revenue_gap_abs:    number | null;

  // Labour
  labour_cost:        number;
  labour_pct:         number | null;

  // Scores
  operating_score:    number;
  score_grade:        ScoreGrade;
  risk_level:         RiskLevel;

  // Compliance
  compliance_overdue: number;
  compliance_due_soon: number;

  // Maintenance
  maintenance_critical: number;
  maintenance_repeat:   number;

  // Actions
  actions_open:       number;
  actions_overdue:    number;
  actions_completion_pct: number | null;

  // Provenance: how each key metric was computed
  provenance:         Record<string, SourceFact[]>;
}

export interface GroupOperationalState {
  organisation_id:        string;
  org_name:               string;
  as_of_date:             string;
  store_count:            number;
  total_revenue:          number;
  total_target:           number;
  group_revenue_gap_pct:  number | null;
  avg_labour_pct:         number | null;
  avg_operating_score:    number | null;
  total_compliance_overdue: number;
  total_maintenance_critical: number;
  total_repeat_failures:  number;
  red_stores:             number;
  yellow_stores:          number;
  green_stores:           number;
  stores:                 StoreOperationalState[];
}

// ── Audit ──────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id:              number;
  occurred_at:     string;
  entity_type:     string;
  entity_id:       string;
  operation:       string;
  actor_user_id:   string | null;
  actor_label:     string | null;
  site_id:         string | null;
  organisation_id: string | null;
  before_state:    Record<string, unknown> | null;
  after_state:     Record<string, unknown> | null;
  diff:            Record<string, unknown> | null;
  notes:           string | null;
  request_id:      string | null;
}

// ── Ingestion ──────────────────────────────────────────────────────────────────

export type IngestionValidationStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "duplicate"
  | "transformed";

export interface SyncBatch {
  id:             string;
  site_id:        string | null;
  source_type:    string;
  started_at:     string;
  completed_at:   string | null;
  records_found:  number | null;
  records_valid:  number | null;
  records_failed: number | null;
  status:         "running" | "success" | "partial" | "failed";
  error_message:  string | null;
  initiated_by:   string | null;
}

export interface IntegrationError {
  id:             string;
  occurred_at:    string;
  site_id:        string | null;
  source_type:    string;
  sync_batch_id:  string | null;
  error_code:     string | null;
  error_message:  string;
  resolved:       boolean;
  resolved_at:    string | null;
  resolved_by:    string | null;
}
