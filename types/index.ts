// ============================================================
// Central type definitions for Ops Engine
// ============================================================

// ------------------------------------------------------------
// Database row shapes (mirrors Supabase schema)
// ------------------------------------------------------------

export interface Reservation {
  id: string;
  customer_name: string;
  phone_number: string;
  booking_date: string;         // ISO date string YYYY-MM-DD
  booking_time: string;         // e.g. "19:00"
  guest_count: number;
  event_name: string | null;
  special_notes: string | null;
  status: ReservationStatus;
  service_charge_applies: boolean;
  escalation_required: boolean;
  source_channel: string;
  created_at: string;
  updated_at: string;
}

export type ReservationStatus = "pending" | "confirmed" | "completed" | "cancelled";

export interface VenueEvent {
  id: string;
  name: string;
  event_date: string;           // ISO date string
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  is_special_event: boolean;
  booking_enabled: boolean;
  cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface VenueSettings {
  id: string;
  venue_name: string;
  max_capacity: number;
  max_table_size: number;
  opening_hours_json: OpeningHours;
  service_charge_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface OpeningHours {
  sunday:    DayHours;
  monday:    DayHours;
  tuesday:   DayHours;
  wednesday: DayHours;
  thursday:  DayHours;
  friday:    DayHours;
  saturday:  DayHours;
}

export interface DayHours {
  open: string;
  close: string;   // "21:30" or "late"
}

export interface ConversationLog {
  id: string;
  phone_number: string;
  user_message: string;
  assistant_message: string | null;
  extracted_intent: string | null;
  extracted_booking_data_json: Partial<BookingDraft> | null;
  escalation_required: boolean;
  wa_message_id: string | null;
  created_at: string;
}

// ------------------------------------------------------------
// Booking flow
// ------------------------------------------------------------

/** Progressively-filled booking data during a WhatsApp conversation */
export interface BookingDraft {
  customer_name: string;
  phone_number: string;
  booking_date: string;
  booking_time: string;
  guest_count: number;
  event_name: string | null;
  special_notes: string | null;
}

/** Fields required before a booking can be confirmed */
export const REQUIRED_BOOKING_FIELDS: (keyof BookingDraft)[] = [
  "customer_name",
  "booking_date",
  "booking_time",
  "guest_count",
];

// ------------------------------------------------------------
// AI / conversation
// ------------------------------------------------------------

export type ConversationIntent =
  | "ask_opening_hours"
  | "ask_events"
  | "make_booking"
  | "private_event_enquiry"
  | "complaint"
  | "greeting"
  | "unknown";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiTurnResult {
  reply: string;
  intent: ConversationIntent;
  bookingDraft: Partial<BookingDraft> | null;
  escalationRequired: boolean;
  bookingComplete: boolean;     // true when all required fields collected
  serviceChargeApplies: boolean; // true when guest_count > threshold (used to drive confirmation message)
}

export interface ExtractionResult {
  customer_name: string | null;
  booking_date: string | null;
  booking_time: string | null;
  guest_count: number | null;
  event_name: string | null;
  special_notes: string | null;
}

// ------------------------------------------------------------
// WhatsApp Cloud API
// ------------------------------------------------------------

export interface WhatsAppWebhookBody {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[]; // WhatsApp always sends this; safe to treat as required
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "interactive" | "button";
  text?: { body: string };
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

// ------------------------------------------------------------
// Event resolver
// ------------------------------------------------------------

export interface ResolvedEvent {
  name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  booking_enabled: boolean;
  source: "database" | "computed";
}

// ============================================================
// Reviews
// ============================================================

export type ReviewPlatform = "google" | "tripadvisor" | "other";
export type ReviewSentiment = "positive" | "neutral" | "negative";
export type ReviewTag =
  | "service"
  | "food"
  | "drinks"
  | "atmosphere"
  | "cleanliness"
  | "value";

export interface Review {
  id: string;
  review_date: string;           // YYYY-MM-DD
  platform: ReviewPlatform;
  rating: number;                // 1–5
  reviewer_name: string | null;
  review_text: string | null;
  sentiment: ReviewSentiment | null;
  tags: ReviewTag[];
  flagged: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Sales
// ============================================================

export interface SalesUpload {
  id: string;
  week_label: string;
  week_start: string;            // YYYY-MM-DD
  week_end: string;              // YYYY-MM-DD
  total_items_sold: number;
  total_sales_value: number;
  uploaded_at: string;
  created_at: string;
}

export interface SalesItem {
  id: string;
  upload_id: string;
  item_name: string;
  category: string | null;
  quantity_sold: number;
  unit_price: number | null;
  total_value: number | null;
  created_at: string;
}

export interface HistoricalSale {
  id: string;
  sale_date: string;     // YYYY-MM-DD
  gross_sales: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Revenue Intelligence Engine
// ============================================================

export interface SalesTarget {
  id: string;
  organization_id: string;
  target_date: string;          // YYYY-MM-DD
  target_sales: number | null;
  target_covers: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Input signals used to build the forecast — stored in factors_json */
export interface ForecastFactors {
  same_day_last_year_sales:  number | null;
  recent_weekday_avg_sales:  number | null;
  recent_weekday_avg_covers: number | null;
  confirmed_covers:          number;
  expected_walk_in_covers:   number;
  historical_avg_spend:      number | null;
  event_name:                string | null;
  event_multiplier:          number;
  signal_count:              number;
  latest_labor_pct:          number | null;
  latest_margin_pct:         number | null;
  out_of_service_count:      number;
}

export interface ForecastRecommendation {
  title:       string;
  description: string;
  priority:    "high" | "medium" | "low";
}

/** Full forecast result returned by generateRevenueForecast() */
export interface RevenueForecast {
  date:                   string;        // YYYY-MM-DD
  forecast_sales:         number;
  forecast_covers:        number;
  forecast_avg_spend:     number;
  target_sales:           number | null;
  target_covers:          number | null;
  /** "manual" = set in sales_targets table; "auto" = derived last-year +10%; null = unavailable */
  target_source:          "manual" | "auto" | null;
  /** Actual same-day last year gross sales used to derive the auto target */
  last_year_sales:        number | null;
  sales_gap:              number | null; // forecast_sales - target_sales (negative = below)
  sales_gap_pct:          number | null; // as % of target
  covers_gap:             number | null;
  required_extra_covers:  number;        // covers needed to close the gap at current avg spend
  confidence:             "low" | "medium" | "high";
  risk_level:             "low" | "medium" | "high";
  risk_reasons:           string[];
  factors:                ForecastFactors;
  recommendations:        ForecastRecommendation[];
}

// ============================================================
// Equipment & Maintenance
// ============================================================

export type EquipmentStatus = "operational" | "needs_attention" | "out_of_service";
export type EquipmentCategory = "kitchen" | "bar" | "facilities" | "other";
export type MaintenancePriority = "urgent" | "high" | "medium" | "low";
export type RepairStatus =
  | "open"
  | "in_progress"
  | "awaiting_parts"
  | "resolved"
  | "closed";
export type MaintenanceImpactLevel =
  | "none"
  | "minor"
  | "service_disruption"
  | "revenue_loss"
  | "compliance_risk"
  | "food_safety_risk";

export interface Equipment {
  id: string;
  unit_name: string;
  category: EquipmentCategory;
  location: string | null;
  status: EquipmentStatus;
  notes: string | null;
  // Asset profile fields (added in migration 011)
  purchase_date: string | null;      // YYYY-MM-DD
  warranty_expiry: string | null;    // YYYY-MM-DD
  supplier: string | null;
  serial_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface EquipmentRepair {
  id: string;
  equipment_id: string;
  repair_date: string;               // YYYY-MM-DD
  contractor_name: string | null;
  contractor_company: string | null;
  contractor_phone: string | null;
  issue_reported: string | null;
  work_done: string | null;
  repair_cost: number | null;
  next_service_due: string | null;   // YYYY-MM-DD
  invoice_file_url: string | null;
  created_at: string;
}

export interface MaintenanceLog {
  id: string;
  equipment_id: string | null;
  unit_name: string;
  category: string;
  issue_title: string;
  issue_description: string | null;
  priority: MaintenancePriority;
  repair_status: RepairStatus;
  /** Business impact classification */
  impact_level: MaintenanceImpactLevel;
  date_reported: string;         // YYYY-MM-DD
  date_acknowledged: string | null;
  /** Canonical fix date — use this for MTTR/analytics */
  date_fixed: string | null;
  /** Legacy alias for date_fixed; preserved for backward compat */
  date_resolved: string | null;
  reported_by: string | null;
  /** Canonical "who fixed it" */
  fixed_by: string | null;
  fixed_by_type: "contractor" | "internal_staff" | "supplier" | "unknown" | null;
  contractor_name: string | null;
  contractor_contact: string | null;
  downtime_minutes: number | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  resolution_notes: string | null;
  /** Legacy alias for fixed_by; preserved for backward compat */
  resolved_by: string | null;
  root_cause: string | null;
  follow_up_required: boolean;
  follow_up_notes: string | null;
  /** True when this issue is actively blocking service */
  service_blocking: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Ops Dashboard — summary shapes returned by service functions
// ============================================================

export interface TodayBookingsSummary {
  total: number;
  totalCovers: number;
  largeBookings: number;
  eventLinked: number;
  escalationsToday: number;
  bookings: Reservation[];
}

export interface PlatformReviewStats {
  platform: ReviewPlatform;
  averageRating: number;
  count: number;
  lowRated: number;
}

export interface SevenDayReviewSummary {
  byPlatform: PlatformReviewStats[];
  overallAverage: number;
  totalReviews: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  flaggedReviews: Review[];
}

export interface SalesSummary {
  upload: SalesUpload | null;
  topItems: SalesItem[];
  bottomItems: SalesItem[];
}

export interface MaintenanceSummary {
  totalEquipment: number;
  openRepairs: number;
  inProgress: number;
  awaitingParts: number;
  outOfService: number;
  urgentIssues: MaintenanceLog[];
  /** Issues resolved in the past 7 days */
  resolvedThisWeek: number;
  /** Mean time to repair across recently resolved issues (days) */
  avgFixTimeDays: number | null;
  /** Sum of actual_cost for issues resolved this month */
  monthlyActualCost: number | null;
  /** Asset name with most issues in last 30 days */
  topProblemAsset: string | null;
  /** Open issues with impact_level = food_safety_risk */
  foodSafetyRisks: number;
  /** Open issues with impact_level = service_disruption */
  serviceDisruptions: number;
  /** Open issues with impact_level = compliance_risk */
  complianceRisks: number;
}

// ============================================================
// Priority Alerts
// ============================================================

export type AlertSeverity = "high" | "medium" | "low";
export type AlertType =
  | "low_review"
  | "escalation"
  | "out_of_service"
  | "urgent_repair"
  | "no_sales_upload"
  | "large_booking"
  | "no_sales_upload"
  | "large_booking";

export interface PriorityAlert {
  type: AlertType;
  severity: AlertSeverity;
  summary: string;
  href: string;
  count?: number;
}

// ============================================================
// Operational Alerts Engine
// ============================================================

/** Severity levels for persisted operational alerts */
export type OperationalAlertSeverity = "low" | "medium" | "high" | "critical";

/** Alert type identifiers — each maps to a distinct check */
export type OperationalAlertType =
  | "revenue_risk"
  | "labor_cost_risk"
  | "margin_risk"
  | "maintenance_risk"
  | "reputation_risk"
  | "compliance_expired"
  | "compliance_due_soon"
  | "equipment_warranty_expiring"
  | "equipment_service_due"
  | "equipment_overdue_attention";

/** A persisted operational alert row from the `alerts` table */
export interface OperationalAlert {
  id: string;
  alert_type: OperationalAlertType;
  location: string | null;
  severity: OperationalAlertSeverity;
  message: string;
  recommendation: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

/** Shape returned by GET /api/alerts */
export interface AlertsApiResponse {
  active_alerts: OperationalAlert[];
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

// ============================================================
// Compliance Hub
// ============================================================

export type ComplianceStatus =
  | "compliant"     // certificate valid, well within renewal window
  | "scheduled"     // valid cert + service/renewal booked before expiry (proactively managed)
  | "due_soon"      // approaching expiry — no pre-expiry service booking confirmed
  | "in_progress"   // renewal or inspection actively underway
  | "expired"       // past due date — active compliance breach
  | "blocked"       // external blocker preventing renewal
  | "unknown";      // no due date configured

export type ComplianceCategory =
  | "fire_certificate"
  | "health_inspection"
  | "pest_control"
  | "equipment_servicing"
  | "liquor_licence"
  | "food_safety_training"
  | "electrical_compliance"
  | "business_licence"
  | "custom";

export interface ComplianceItem {
  id: string;
  category: ComplianceCategory | string;
  display_name: string;
  description: string | null;
  status: ComplianceStatus;
  last_inspection_date: string | null;  // YYYY-MM-DD
  next_due_date: string | null;         // YYYY-MM-DD — certificate expiry date
  responsible_party: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  documents?: ComplianceDocument[];
  // ── Proactive scheduling fields (optional; populated after DB migration) ──
  /** ISO date of the booked renewal / service visit (YYYY-MM-DD) */
  scheduled_service_date?: string | null;
  /** Contractor, authority, or supplier handling the renewal */
  scheduled_with?: string | null;
  /** Booking state, e.g. "booked", "confirmed", "in_progress" */
  service_status?: string | null;
  /** Explicit certificate expiry override — falls back to next_due_date */
  certificate_expiry_date?: string | null;
  /** Computed risk contribution 0–1 (derived by scoring helper) */
  risk_weight?: number | null;
  /** Mitigation lifecycle state */
  mitigation_state?: "unmanaged" | "scheduled" | "in_progress" | "resolved" | null;
}

export interface ComplianceDocument {
  id: string;
  item_id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

/** Aggregate summary used on the main dashboard and compliance page header */
export interface ComplianceSummary {
  total: number;
  compliant: number;
  /** Items whose certificate is still valid AND have a service booked before expiry */
  scheduled: number;
  /** Items nearing expiry with NO confirmed pre-expiry booking */
  due_soon: number;
  expired: number;
  unknown: number;
  /**
   * (compliant + scheduled) / (total - unknown) × 100
   * Scheduled items are treated as effectively compliant for percentage purposes.
   */
  compliance_pct: number;
  critical_items: ComplianceItem[];   // expired items
  due_soon_items: ComplianceItem[];   // unscheduled due-soon items
  scheduled_items: ComplianceItem[];  // proactively managed items
}

