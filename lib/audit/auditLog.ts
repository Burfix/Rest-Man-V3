/**
 * Audit Log Writer
 *
 * Writes entries to the audit_log table using the service-role
 * client (bypasses RLS for the immutable insert).
 *
 * Import this from any service that performs a critical state change:
 *   await writeAuditLog({ ... })
 *
 * The actual audit_log table is APPEND-ONLY (UPDATE/DELETE rules
 * defined in migration 025 prevent any mutation).
 */

import { createClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuditLogInput {
  entityType:     string;
  entityId:       string;
  operation:      string;
  actorUserId?:   string;
  actorLabel?:    string;
  siteId?:        string;
  organisationId?: string;
  beforeState?:   Record<string, unknown>;
  afterState?:    Record<string, unknown>;
  diff?:          Record<string, unknown>;
  notes?:         string;
  requestId?:     string;
}

// ── Service-role client ────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Writer ────────────────────────────────────────────────────────────────────

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await db().from("audit_log").insert({
      entity_type:     input.entityType,
      entity_id:       input.entityId,
      operation:       input.operation,
      actor_user_id:   input.actorUserId ?? null,
      actor_label:     input.actorLabel ?? null,
      site_id:         input.siteId ?? null,
      organisation_id: input.organisationId ?? null,
      before_state:    input.beforeState ?? null,
      after_state:     input.afterState ?? null,
      diff:            input.diff ?? null,
      notes:           input.notes ?? null,
      request_id:      input.requestId ?? null,
    });
  } catch (err) {
    // Audit failures must never crash the calling operation.
    // Log to console for observability but swallow the error.
    console.error("[AuditLog] Failed to write audit entry:", err, input);
  }
}

// ── Reader helpers ─────────────────────────────────────────────────────────────

export async function getAuditTrail(
  entityType: string,
  entityId:   string
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db()
    .from("audit_log")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("occurred_at", { ascending: true });

  if (error) throw new Error(`[AuditLog] getAuditTrail: ${error.message}`);
  return data ?? [];
}

export async function getSiteAuditLog(
  siteId:   string,
  limit     = 100
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db()
    .from("audit_log")
    .select("*")
    .eq("site_id", siteId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[AuditLog] getSiteAuditLog: ${error.message}`);
  return data ?? [];
}

export async function getOrgAuditLog(
  orgId:   string,
  limit    = 200
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db()
    .from("audit_log")
    .select("*")
    .eq("organisation_id", orgId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[AuditLog] getOrgAuditLog: ${error.message}`);
  return data ?? [];
}
