/**
 * Notification adapter interface.
 *
 * Implement this interface to add any outbound notification channel:
 * WhatsApp, Slack, Email, SMS, PagerDuty, etc.
 *
 * The alerts engine calls `sendAlert()` on every registered adapter
 * whenever a new alert is persisted. Adapters must be stateless and
 * idempotent — they may be called multiple times for the same alert
 * if the scheduler fires before a previous run settles.
 *
 * ──────────────────────────────────────────────────────────────────
 * ADDING A NEW CHANNEL
 * ──────────────────────────────────────────────────────────────────
 *
 * 1. Create a file in this directory, e.g. `whatsapp.ts`
 * 2. Export a class or object that implements `NotificationAdapter`
 * 3. Register it in `adapters/index.ts`
 *
 * Example:
 *
 *   export class WhatsAppAdapter implements NotificationAdapter {
 *     readonly channel = "whatsapp" as const;
 *
 *     async sendAlert(alert: OperationalAlert): Promise<void> {
 *       await whatsappClient.send(MANAGER_NUMBER, formatMessage(alert));
 *     }
 *   }
 */

import type { OperationalAlert } from "@/types";

export interface NotificationAdapter {
  /** Human-readable channel name used in logs */
  readonly channel: string;

  /**
   * Dispatch an alert to this channel.
   * Must not throw — failures should be caught and logged internally.
   */
  sendAlert(alert: OperationalAlert): Promise<void>;
}

/**
 * Null adapter — used as a safe no-op default.
 * Replace or supplement with real adapters in production.
 */
export class NullAdapter implements NotificationAdapter {
  readonly channel = "null";

  async sendAlert(alert: OperationalAlert): Promise<void> {
    // No-op: structured for future extension
    console.log(
      `[alerts/null] ${alert.severity.toUpperCase()} — ${alert.alert_type}: ${alert.message}`
    );
  }
}
