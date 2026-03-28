/**
 * API Input Validation Schemas — Zod
 *
 * Central home for all API route input schemas.
 * Every POST/PATCH body must be validated before touching the database.
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

const severity = z.enum(["low", "medium", "high", "critical"]);
const actionStatus = z.enum([
  "pending",
  "in_progress",
  "completed",
  "escalated",
  "cancelled",
]);
const actionCategory = z.enum([
  "revenue",
  "labour",
  "food_cost",
  "stock",
  "maintenance",
  "compliance",
  "service",
  "general",
]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const timeString = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM");
const uuidString = z.string().uuid();

// ── Actions ───────────────────────────────────────────────────────────────────

export const createActionSchema = z.object({
  title: z.string().min(1).max(500),
  direct_instruction: z.string().max(2000).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category: actionCategory.optional().nullable(),
  severity: severity.optional(),
  status: actionStatus.optional(),
  owner: z.string().max(200).optional().nullable(),
  assigned_to: z.string().max(200).optional().nullable(),
  assignee_role: z.string().max(100).optional().nullable(),
  source_type: z.string().max(100).optional().nullable(),
  source_module: z.string().max(100).optional().nullable(),
  source_id: z.string().max(200).optional().nullable(),
  zone_id: z.string().max(200).optional().nullable(),
  due_at: z.string().max(100).optional().nullable(),
  expected_impact_value: z.number().optional().nullable(),
  expected_impact_text: z.string().max(500).optional().nullable(),
  expected_impact: z.string().max(500).optional().nullable(),
  why_it_matters: z.string().max(1000).optional().nullable(),
  impact_weight: severity.optional().nullable(),
  decision_id: uuidString.optional().nullable(),
});

export const patchActionSchema = z.object({
  status: actionStatus,
  actor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const createActionEventSchema = z.object({
  event_type: z.enum([
    "created",
    "started",
    "completed",
    "escalated",
    "cancelled",
    "reopened",
    "assigned",
    "note",
  ]),
  actor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

// ── Compliance ────────────────────────────────────────────────────────────────

export const createComplianceItemSchema = z.object({
  display_name: z.string().min(1).max(300),
  category: z.string().max(100).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  last_inspection_date: dateString.optional().nullable(),
  next_due_date: dateString.optional().nullable(),
  responsible_party: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const updateComplianceItemSchema = z.object({
  display_name: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional().nullable(),
  last_inspection_date: dateString.optional().nullable(),
  next_due_date: dateString.optional().nullable(),
  responsible_party: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  scheduled_service_date: dateString.optional().nullable(),
  scheduled_with: z.string().max(200).optional().nullable(),
  scheduled_by: z.string().max(200).optional().nullable(),
  schedule_note: z.string().max(2000).optional().nullable(),
});

// ── Inventory ─────────────────────────────────────────────────────────────────

export const createInventoryMovementSchema = z.object({
  inventory_item_id: uuidString,
  type: z.enum(["usage", "order", "delivery", "adjustment", "waste"]),
  quantity: z.number(),
  note: z.string().max(500).optional().nullable(),
});

export const createPurchaseOrderSchema = z.object({
  supplier_name: z.string().min(1).max(300),
  items: z
    .array(
      z.object({
        inventory_item_id: uuidString,
        quantity: z.number().positive(),
        unit_price: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const patchPurchaseOrderSchema = z.object({
  status: z.enum(["ordered", "received", "cancelled"]),
});

// ── Maintenance ───────────────────────────────────────────────────────────────

export const createEquipmentSchema = z.object({
  unit_name: z.string().min(1).max(300),
  category: z.enum(["kitchen", "bar", "facilities", "other"]),
  location: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  serial_number: z.string().max(100).optional().nullable(),
  supplier: z.string().max(200).optional().nullable(),
  purchase_date: dateString.optional().nullable(),
  warranty_expiry: dateString.optional().nullable(),
});

export const patchEquipmentSchema = z.object({
  id: uuidString,
  unit_name: z.string().min(1).max(300).optional(),
  category: z.enum(["kitchen", "bar", "facilities", "other"]).optional(),
  location: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  serial_number: z.string().max(100).optional().nullable(),
  supplier: z.string().max(200).optional().nullable(),
  purchase_date: dateString.optional().nullable(),
  warranty_expiry: dateString.optional().nullable(),
});

export const createMaintenanceIssueSchema = z.object({
  unit_name: z.string().min(1).max(300),
  issue_title: z.string().min(1).max(500),
  priority: z.enum(["low", "medium", "high", "critical"]),
  equipment_id: uuidString.optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  issue_description: z.string().max(2000).optional().nullable(),
  impact_level: z.enum(["none", "low", "medium", "high", "service_blocking"]).optional().nullable(),
  reported_by: z.string().max(200).optional().nullable(),
  repair_status: z.string().max(50).optional().nullable(),
  date_reported: dateString.optional().nullable(),
});

export const patchMaintenanceIssueSchema = z.object({
  id: uuidString,
  repair_status: z.string().min(1).max(50),
  fixed_by: z.string().max(200).optional().nullable(),
  fixed_by_type: z.enum(["internal", "contractor", "warranty"]).optional().nullable(),
  contractor_name: z.string().max(200).optional().nullable(),
  contractor_contact: z.string().max(200).optional().nullable(),
  date_fixed: dateString.optional().nullable(),
  actual_cost: z.number().nonnegative().optional().nullable(),
  downtime_minutes: z.number().nonnegative().optional().nullable(),
  resolution_notes: z.string().max(2000).optional().nullable(),
  root_cause: z.string().max(500).optional().nullable(),
  follow_up_required: z.boolean().optional().nullable(),
  follow_up_notes: z.string().max(2000).optional().nullable(),
});

export const createRepairSchema = z.object({
  equipment_id: uuidString,
  repair_date: dateString,
  contractor_name: z.string().max(200).optional().nullable(),
  contractor_company: z.string().max(200).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  issue_reported: z.string().max(2000).optional().nullable(),
  work_done: z.string().max(2000).optional().nullable(),
  repair_cost: z.number().nonnegative().optional().nullable(),
  next_service_due: dateString.optional().nullable(),
  invoice_file_url: z.string().url().optional().nullable(),
});

// ── Bookings ──────────────────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  customer_name: z.string().min(1).max(200),
  phone_number: z.string().min(1).max(50),
  booking_date: dateString,
  booking_time: timeString,
  guest_count: z.number().int().positive(),
  event_name: z.string().max(200).optional().nullable(),
  special_notes: z.string().max(2000).optional().nullable(),
  customer_email: z.string().email().optional().nullable(),
});

export const patchBookingStatusSchema = z.object({
  status: z.enum(["confirmed", "cancelled", "pending"]),
  notify: z.boolean().optional(),
});

// ── Reviews ───────────────────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  platform: z.enum(["google", "tripadvisor", "facebook", "instagram", "other"]),
  review_date: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  reviewer_name: z.string().max(200).optional().nullable(),
  review_text: z.string().max(5000).optional().nullable(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional().nullable(),
});

// ── Revenue Targets ───────────────────────────────────────────────────────────

export const createRevenueTargetSchema = z.object({
  target_date: dateString,
  target_sales: z.number().nonnegative().optional().nullable(),
  target_covers: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// ── Sales Manual Upload ───────────────────────────────────────────────────────

export const manualSalesSchema = z.object({
  business_date: dateString,
  gross_sales: z.number().nonnegative().optional().nullable(),
  covers: z.number().int().nonnegative().optional().nullable(),
  checks: z.number().int().nonnegative().optional().nullable(),
  avg_spend_per_cover: z.number().nonnegative().optional().nullable(),
  avg_check_value: z.number().nonnegative().optional().nullable(),
  labour_percent: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  source_file_name: z.string().max(300).optional().nullable(),
  uploaded_by: z.string().max(200).optional().nullable(),
});

// ── Inventory Sync ────────────────────────────────────────────────────────────

export const inventorySyncSchema = z.object({
  businessDate: dateString.optional(),
  locationCode: z.string().max(100).optional(),
  forceFullSync: z.boolean().optional(),
});

// ── MICROS Settings ───────────────────────────────────────────────────────────

export const microsSettingsSchema = z.object({
  id: uuidString.optional(),
  location_name: z.string().max(200).optional().nullable(),
  loc_ref: z.string().max(100).optional().nullable(),
  auth_server_url: z.string().url().min(1),
  app_server_url: z.string().url().min(1),
  client_id: z.string().min(1).max(200),
  org_identifier: z.string().min(1).max(200),
});

// ── Helper: safe parse + respond ──────────────────────────────────────────────

// ── Admin: Stores ─────────────────────────────────────────────────────────────

export const createStoreSchema = z.object({
  name: z.string().min(1).max(200),
  store_code: z.string().min(1).max(50),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(200).optional().nullable(),
  timezone: z.string().max(100).optional().default("Africa/Johannesburg"),
  region_id: z.string().uuid().optional().nullable(),
  seating_capacity: z.number().int().positive().optional().nullable(),
  target_avg_spend: z.number().nonnegative().optional().nullable(),
  target_labour_pct: z.number().min(0).max(100).optional().nullable(),
  target_margin_pct: z.number().min(0).max(100).optional().nullable(),
});

export const patchStoreSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  store_code: z.string().min(1).max(50).optional(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(200).optional().nullable(),
  timezone: z.string().max(100).optional(),
  region_id: z.string().uuid().optional().nullable(),
  seating_capacity: z.number().int().positive().optional().nullable(),
  target_avg_spend: z.number().nonnegative().optional().nullable(),
  target_labour_pct: z.number().min(0).max(100).optional().nullable(),
  target_margin_pct: z.number().min(0).max(100).optional().nullable(),
  is_active: z.boolean().optional(),
});

// ── Admin: Users ──────────────────────────────────────────────────────────────

export const inviteUserSchema = z.object({
  email: z.string().email().max(300),
  full_name: z.string().min(1).max(200),
  role: z.enum([
    "super_admin", "executive", "head_office", "area_manager",
    "gm", "supervisor", "contractor", "auditor", "viewer",
  ]),
  site_id: z.string().uuid().optional().nullable(),
  region_id: z.string().uuid().optional().nullable(),
});

export const patchUserRoleSchema = z.object({
  role: z.enum([
    "super_admin", "executive", "head_office", "area_manager",
    "gm", "supervisor", "contractor", "auditor", "viewer",
  ]),
  site_id: z.string().uuid().optional().nullable(),
  region_id: z.string().uuid().optional().nullable(),
});

export const grantSiteAccessSchema = z.object({
  site_ids: z.array(z.string().uuid()).min(1),
});

// ── Validator helper ──────────────────────────────────────────────────────────

export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; response: Response } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: "Validation failed",
          details: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  return { success: true, data: result.data };
}
