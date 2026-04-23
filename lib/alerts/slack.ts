/**
 * lib/alerts/slack.ts
 *
 * Structured Slack alerting for sync operations.
 *
 * Three alert classes:
 * - sync.suspicious_empty   → #forgestack-ops-warnings
 * - sync.consecutive_failures → #forgestack-ops-alerts
 * - sync.token_expiring     → #forgestack-ops-warnings
 *
 * Deduplication: persisted in `sent_alerts` table.
 * Same (alert_class, connection_id, sync_type, date_key) will not fire
 * more than once per DEDUP_WINDOW_MS (6 hours).
 *
 * Env vars required:
 * - SLACK_WEBHOOK_WARNINGS  — #forgestack-ops-warnings
 * - SLACK_WEBHOOK_ALERTS    — #forgestack-ops-alerts
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export type AlertClass =
  | "sync.suspicious_empty"
  | "sync.consecutive_failures"
  | "sync.token_expiring";

interface SentAlertRow {
  alert_class: AlertClass;
  connection_id: string;
  sync_type: string;
  date_key: string;
  sent_at: string;
}

const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Public alert functions ────────────────────────────────────────────────────

export async function maybeSendSuspiciousEmptyAlert(opts: {
  connection_id: string;
  sync_type: string;
  business_date: string;
  trace_id: string;
}): Promise<void> {
  const deduped = await checkDedup("sync.suspicious_empty", opts.connection_id, opts.sync_type, opts.business_date);
  if (deduped) return;

  const text = [
    `⚠️ *Suspicious Empty Sync*`,
    `Connection: \`${opts.connection_id.slice(0, 8)}…\``,
    `Sync type: \`${opts.sync_type}\``,
    `Business date: \`${opts.business_date}\``,
    `Zero records returned on a likely trading day. Check POS connectivity.`,
    `Trace: \`${opts.trace_id}\``,
  ].join("\n");

  await send("warnings", text);
  await recordSent("sync.suspicious_empty", opts.connection_id, opts.sync_type, opts.business_date);
}

export async function maybeSendConsecutiveFailuresAlert(opts: {
  connection_id: string;
  sync_type: string;
  consecutive_failures: number;
  last_error?: string;
}): Promise<void> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const deduped = await checkDedup(
    "sync.consecutive_failures",
    opts.connection_id,
    opts.sync_type,
    dateKey,
  );
  if (deduped) return;

  const text = [
    `🔴 *Sync Consecutive Failures: ${opts.consecutive_failures}*`,
    `Connection: \`${opts.connection_id.slice(0, 8)}…\``,
    `Sync type: \`${opts.sync_type}\``,
    `Last error: ${opts.last_error ?? "(no detail)"}`,
    `Action required: check \`/dashboard/settings/integrations\` and Supabase logs.`,
  ].join("\n");

  await send("alerts", text);
  await recordSent("sync.consecutive_failures", opts.connection_id, opts.sync_type, dateKey);
}

export async function maybeSendTokenExpiringAlert(opts: {
  connection_id: string;
  location_name: string;
  token_expires_at: string;
  days_remaining: number;
}): Promise<void> {
  const dateKey = opts.token_expires_at.slice(0, 10);
  const deduped = await checkDedup(
    "sync.token_expiring",
    opts.connection_id,
    "auth",
    dateKey,
  );
  if (deduped) return;

  const text = [
    `⏳ *Oracle Token Expiring Soon*`,
    `Location: *${opts.location_name}*`,
    `Connection: \`${opts.connection_id.slice(0, 8)}…\``,
    `Expires: \`${opts.token_expires_at}\` (${opts.days_remaining} day${opts.days_remaining !== 1 ? "s" : ""} remaining)`,
    `Action: Re-authenticate at \`/dashboard/settings/integrations\` before expiry.`,
  ].join("\n");

  await send("warnings", text);
  await recordSent("sync.token_expiring", opts.connection_id, "auth", dateKey);
}

// ── Dedup helpers ─────────────────────────────────────────────────────────────

async function checkDedup(
  alertClass: AlertClass,
  connectionId: string,
  syncType: string,
  dateKey: string,
): Promise<boolean> {
  try {
    const supabase = createServerClient();
    const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

    // sent_alerts table added in migration 062 — cast until types are regenerated
    const db = supabase as unknown as { from: (t: string) => any };
    const { data } = await db
      .from("sent_alerts")
      .select("id")
      .eq("alert_class", alertClass)
      .eq("connection_id", connectionId)
      .eq("sync_type", syncType)
      .eq("date_key", dateKey)
      .gte("sent_at", windowStart)
      .maybeSingle();

    return !!data; // true = already sent within window → skip
  } catch (err) {
    logger.warn("slack_alerts.dedup_check_failed", { err: String(err) });
    return false; // fail open — better to over-alert than to suppress
  }
}

async function recordSent(
  alertClass: AlertClass,
  connectionId: string,
  syncType: string,
  dateKey: string,
): Promise<void> {
  try {
    const supabase = createServerClient();
    // sent_alerts table added in migration 062 — cast until types are regenerated
    const db = supabase as unknown as { from: (t: string) => any };
    await db.from("sent_alerts").insert({
      alert_class: alertClass,
      connection_id: connectionId,
      sync_type: syncType,
      date_key: dateKey,
      sent_at: new Date().toISOString(),
    } satisfies Omit<SentAlertRow, "id">);
  } catch (err) {
    logger.warn("slack_alerts.record_sent_failed", { err: String(err) });
  }
}

// ── HTTP sender ───────────────────────────────────────────────────────────────

type Channel = "warnings" | "alerts";

async function send(channel: Channel, text: string): Promise<void> {
  const webhookUrl =
    channel === "alerts"
      ? process.env.SLACK_WEBHOOK_ALERTS
      : process.env.SLACK_WEBHOOK_WARNINGS;

  if (!webhookUrl) {
    logger.warn("slack_alerts.no_webhook", { channel, textPreview: text.slice(0, 80) });
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      logger.warn("slack_alerts.send_failed", { channel, status: res.status });
    }
  } catch (err) {
    logger.error("slack_alerts.send_error", { channel, err: String(err) });
  }
}
