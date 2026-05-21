/**
 * lib/whatsapp/format.ts
 *
 * Formats structured alert data into a WhatsApp-ready text message.
 *
 * Meta WhatsApp text messages: max 4096 chars (we cap at 1600 for readability).
 * Format uses plain text — no markdown beyond newlines (Meta renders it fine).
 */

import type { AlertSeverity } from "@/lib/alerts/rules";

export interface AlertMessageParams {
  siteName:        string;
  severity:        AlertSeverity;
  title:           string;
  message:         string;
  alertId:         string;
  /** ISO-8601 timestamp, formatted to HH:mm SAST */
  timestamp?:      string;
  /** Optional action hint shown below the message body */
  suggestedAction?: string;
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info:     "ℹ️  Info",
  warning:  "⚠️  Warning",
  critical: "🔴 Critical",
};

/**
 * Build the text body for a WhatsApp alert message.
 *
 * Example output:
 * ```
 * [ForgeStack Alert]
 * Site: Primi Camps Bay
 * Severity: 🔴 Critical
 * Issue: Labour sync stale for 4h
 *
 * Labour data has not refreshed since 08:00. Staffing numbers may be inaccurate.
 *
 * Action: Please check MICROS labour sync and confirm staffing data.
 *
 * Reply ACK-a1b2c3d4 to acknowledge.
 * ```
 */
export function formatAlertMessage(params: AlertMessageParams): string {
  const {
    siteName,
    severity,
    title,
    message,
    alertId,
    timestamp,
    suggestedAction,
  } = params;

  const shortId = alertId.slice(0, 8);

  const lines: string[] = [
    "[ForgeStack Alert]",
    `Site: ${siteName}`,
    `Severity: ${SEVERITY_LABEL[severity] ?? severity}`,
    `Issue: ${title}`,
    "",
    message.trim(),
  ];

  if (suggestedAction) {
    lines.push("", `Action: ${suggestedAction}`);
  }

  if (timestamp) {
    const ts = formatLocalTime(timestamp);
    if (ts) lines.push("", `Sent: ${ts}`);
  }

  lines.push("", `Reply ACK-${shortId} to acknowledge.`);

  return lines.join("\n").slice(0, 1600);
}

/** Format ISO-8601 to "21 May 2026 14:30 SAST" */
function formatLocalTime(iso: string): string | null {
  try {
    return new Date(iso).toLocaleString("en-ZA", {
      day:      "numeric",
      month:    "short",
      year:     "numeric",
      hour:     "2-digit",
      minute:   "2-digit",
      timeZone: "Africa/Johannesburg",
    }) + " SAST";
  } catch {
    return null;
  }
}

/**
 * Parse an ACK reply from a WhatsApp inbound message.
 * Returns the alert short-ID (8 hex chars) or null if not an ACK.
 *
 * Handles variants:
 *   "ACK-a1b2c3d4"
 *   "ack a1b2c3d4"
 *   "ACK"              (no ID — caller must match by sender phone)
 */
export function parseAckReply(text: string): { shortId: string | null; isAck: boolean } {
  const normalised = text.trim().toUpperCase();

  if (!normalised.startsWith("ACK")) {
    return { shortId: null, isAck: false };
  }

  // Extract hex short ID after ACK separator (space, dash, or nothing)
  const match = normalised.match(/^ACK[-\s]?([0-9A-F]{8})$/i);
  return {
    isAck:   true,
    shortId: match ? match[1].toLowerCase() : null,
  };
}
