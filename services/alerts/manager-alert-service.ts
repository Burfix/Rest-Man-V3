/**
 * services/alerts/manager-alert-service.ts
 *
 * Core business logic for the Manager Alert Engine.
 *
 * Responsibilities:
 *  - Create alert rows in manager_alerts
 *  - Resolve site name for formatting
 *  - Enforce 30-minute dedup (same manager + type + site)
 *  - Call WhatsApp provider and record delivery result
 *  - Mark acknowledged (by user or via webhook ACK)
 *  - Fail-safe: WhatsApp errors update the row but do not throw to callers
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getWhatsAppProvider, WhatsAppDeliveryError } from "@/lib/whatsapp/provider";
import { formatAlertMessage } from "@/lib/whatsapp/format";
import type {
  CreateManagerAlertInput,
  ManagerAlert,
  ManagerAlertWithContact,
  AlertListFilters,
} from "@/types/manager-alerts";

// ── Dedup window ──────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MINUTES = 30;

// ── Create alert ──────────────────────────────────────────────────────────────

/**
 * Create a manager alert row.
 * Does NOT send — call sendAlert() after creation, or set send_now in API layer.
 */
export async function createManagerAlert(
  input: CreateManagerAlertInput,
): Promise<ManagerAlert> {
  const db = createServerClient();

  const { data, error } = await db
    .from("manager_alerts")
    .insert({
      site_id:     input.site_id,
      manager_id:  input.manager_id,
      alert_type:  input.alert_type,
      severity:    input.severity,
      source:      input.source,
      title:       input.title,
      message:     input.message,
      incident_id: input.incident_id ?? null,
      created_by:  input.created_by ?? null,
      status:      "pending",
    })
    .select()
    .single();

  if (error || !data) {
    logger.error("[ManagerAlertService] createManagerAlert failed", {
      error: error?.message,
      input,
    });
    throw new Error(`Failed to create manager alert: ${error?.message ?? "unknown"}`);
  }

  logger.info("[ManagerAlertService] alert created", {
    id:         data.id,
    site_id:    data.site_id,
    manager_id: data.manager_id,
    alert_type: data.alert_type,
    severity:   data.severity,
  });

  return data as ManagerAlert;
}

// ── Send alert via WhatsApp ────────────────────────────────────────────────────

export interface SendAlertResult {
  ok:         boolean;
  messageId?: string;
  error?:     string;
  skipped?:   boolean;
  reason?:    string;
}

/**
 * Attempt WhatsApp delivery for an existing pending alert.
 *
 * Safety guarantees:
 *  - Returns {ok:false, skipped:true} if within dedup window (no re-send)
 *  - Returns {ok:false, error} if WhatsApp delivery fails — row updated to 'failed'
 *  - Never throws to caller
 */
export async function sendManagerAlert(alertId: string): Promise<SendAlertResult> {
  const db = createServerClient();

  // 1. Load alert + manager contact
  const { data: alert, error: fetchErr } = await db
    .from("manager_alerts")
    .select(`
      *,
      manager:manager_contacts (
        id, name, role, phone_whatsapp, is_active, alert_preferences
      )
    `)
    .eq("id", alertId)
    .single();

  if (fetchErr || !alert) {
    logger.error("[ManagerAlertService] sendManagerAlert — alert not found", {
      alertId,
      error: fetchErr?.message,
    });
    return { ok: false, error: "Alert not found" };
  }

  const manager = (alert as { manager?: { name: string; phone_whatsapp: string; is_active: boolean } }).manager;

  if (!manager) {
    return { ok: false, error: "Manager contact not found" };
  }

  if (!manager.is_active) {
    logger.info("[ManagerAlertService] manager is inactive — skipping delivery", {
      alertId,
      manager_id: alert.manager_id,
    });
    await db
      .from("manager_alerts")
      .update({ status: "failed", failed_reason: "Manager contact is inactive" })
      .eq("id", alertId);
    return { ok: false, skipped: true, reason: "Manager contact is inactive" };
  }

  // 2. Dedup check — same manager + alert_type + site within 30 minutes
  if (alert.status !== "pending" && alert.status !== "failed") {
    return {
      ok:      false,
      skipped: true,
      reason:  `Alert already in status '${alert.status}'`,
    };
  }

  const dedupSince = new Date(
    Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const { count: recentCount } = await db
    .from("manager_alerts")
    .select("id", { count: "exact", head: true })
    .eq("manager_id",  alert.manager_id)
    .eq("alert_type",  alert.alert_type)
    .eq("site_id",     alert.site_id)
    .eq("status",      "sent")
    .neq("id",         alertId)
    .gte("sent_at",    dedupSince);

  if ((recentCount ?? 0) > 0 && alert.retry_count === 0) {
    logger.info("[ManagerAlertService] dedup — skipping re-send within window", {
      alertId,
      manager_id: alert.manager_id,
      alert_type: alert.alert_type,
      window_minutes: DEDUP_WINDOW_MINUTES,
    });
    return {
      ok:      false,
      skipped: true,
      reason:  `Same alert type sent within ${DEDUP_WINDOW_MINUTES} minutes`,
    };
  }

  // 3. Resolve site name for message formatting
  const { data: site } = await db
    .from("sites")
    .select("name")
    .eq("id", alert.site_id)
    .single();

  const siteName = site?.name ?? "Your Site";

  // 4. Format message
  const body = formatAlertMessage({
    siteName,
    severity:  alert.severity as "info" | "warning" | "critical",
    title:     alert.title,
    message:   alert.message,
    alertId:   alert.id,
    timestamp: new Date().toISOString(),
  });

  // 5. WhatsApp delivery — fail-safe
  const provider = getWhatsAppProvider();

  if (!provider.isConfigured()) {
    logger.warn("[ManagerAlertService] WhatsApp provider not configured — marking failed", {
      alertId,
    });
    await db
      .from("manager_alerts")
      .update({
        status:        "failed",
        failed_reason: "WHATSAPP_NOT_CONFIGURED: Missing env vars",
        retry_count:   (alert.retry_count ?? 0) + 1,
      })
      .eq("id", alertId);
    return { ok: false, error: "WhatsApp provider not configured" };
  }

  try {
    const result = await provider.sendTextMessage(manager.phone_whatsapp, body);

    await db
      .from("manager_alerts")
      .update({
        status:               "sent",
        whatsapp_message_id:  result.messageId,
        sent_at:              new Date().toISOString(),
        failed_reason:        null,
      })
      .eq("id", alertId);

    logger.info("[ManagerAlertService] alert sent via WhatsApp", {
      alertId,
      messageId: result.messageId,
      provider:  result.provider,
      phone:     manager.phone_whatsapp.slice(0, 6) + "****",
    });

    return { ok: true, messageId: result.messageId };
  } catch (err) {
    const errMsg = err instanceof WhatsAppDeliveryError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);

    await db
      .from("manager_alerts")
      .update({
        status:        "failed",
        failed_reason: errMsg.slice(0, 500),
        retry_count:   (alert.retry_count ?? 0) + 1,
      })
      .eq("id", alertId);

    logger.error("[ManagerAlertService] WhatsApp delivery failed", {
      alertId,
      error: errMsg,
    });

    return { ok: false, error: errMsg };
  }
}

// ── Acknowledge ───────────────────────────────────────────────────────────────

/**
 * Mark an alert as acknowledged.
 * acknowledgedBy: user UUID if via UI; null if via WhatsApp ACK reply.
 */
export async function acknowledgeAlert(
  alertId: string,
  acknowledgedBy: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = createServerClient();

  const { error } = await db
    .from("manager_alerts")
    .update({
      status:          "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: acknowledgedBy,
    })
    .eq("id", alertId)
    .in("status", ["sent", "pending"]);

  if (error) {
    logger.error("[ManagerAlertService] acknowledgeAlert failed", {
      alertId,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  logger.info("[ManagerAlertService] alert acknowledged", {
    alertId,
    acknowledgedBy: acknowledgedBy ?? "whatsapp_reply",
  });

  return { ok: true };
}

// ── List alerts ───────────────────────────────────────────────────────────────

export async function listManagerAlerts(
  filters: AlertListFilters,
): Promise<ManagerAlertWithContact[]> {
  const db = createServerClient();

  let query = db
    .from("manager_alerts")
    .select(`
      *,
      manager:manager_contacts (name, role, phone_whatsapp)
    `)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 50)
    .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);

  if (filters.site_id)    query = query.eq("site_id",    filters.site_id);
  if (filters.status)     query = query.eq("status",     filters.status);
  if (filters.severity)   query = query.eq("severity",   filters.severity);
  if (filters.alert_type) query = query.eq("alert_type", filters.alert_type);
  if (filters.manager_id) query = query.eq("manager_id", filters.manager_id);

  const { data, error } = await query;

  if (error) {
    logger.error("[ManagerAlertService] listManagerAlerts failed", { error: error.message, filters });
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const manager = row.manager as { name: string; role: string; phone_whatsapp: string } | null;
    return {
      ...row,
      manager_name:  manager?.name  ?? "",
      manager_role:  manager?.role  ?? "",
      manager_phone: manager?.phone_whatsapp ?? "",
    } as ManagerAlertWithContact;
  });
}

// ── List manager contacts ─────────────────────────────────────────────────────

export async function listManagerContacts(siteId: string) {
  const db = createServerClient();

  const { data, error } = await db
    .from("manager_contacts")
    .select("*")
    .eq("site_id",   siteId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    logger.error("[ManagerAlertService] listManagerContacts failed", {
      siteId,
      error: error.message,
    });
    return [];
  }

  return data ?? [];
}

// ── Acknowledge via WhatsApp webhook ──────────────────────────────────────────

/**
 * Try to acknowledge an alert from an inbound WhatsApp ACK reply.
 * Matches by the short alert ID in the reply text ("ACK-a1b2c3d4").
 * Falls back to most-recent sent alert for the sender's phone if no ID.
 */
export async function acknowledgeViaWebhook(
  fromPhone: string,
  shortId: string | null,
): Promise<{ ok: boolean; alertId?: string }> {
  const db = createServerClient();

  let alertId: string | null = null;

  if (shortId) {
    // Match by alert short ID prefix
    const { data } = await db
      .from("manager_alerts")
      .select("id, manager_id")
      .ilike("id", `${shortId}%`)
      .in("status", ["sent", "pending"])
      .limit(1)
      .single();

    alertId = data?.id ?? null;
  }

  if (!alertId) {
    // Fallback: most recent sent alert for this phone number
    const { data: contact } = await db
      .from("manager_contacts")
      .select("id")
      .eq("phone_whatsapp", fromPhone)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (contact) {
      const { data: recentAlert } = await db
        .from("manager_alerts")
        .select("id")
        .eq("manager_id", contact.id)
        .in("status", ["sent", "pending"])
        .order("sent_at", { ascending: false })
        .limit(1)
        .single();

      alertId = recentAlert?.id ?? null;
    }
  }

  if (!alertId) {
    logger.info("[ManagerAlertService] webhook ACK — no matching alert found", {
      fromPhone: fromPhone.slice(0, 6) + "****",
      shortId,
    });
    return { ok: false };
  }

  const result = await acknowledgeAlert(alertId, null);
  return { ok: result.ok, alertId };
}
