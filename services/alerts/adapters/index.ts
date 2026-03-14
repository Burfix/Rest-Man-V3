/**
 * Registered notification adapters.
 *
 * Add adapters here to enable outbound notifications.
 * The alerts engine iterates this array after each check run.
 *
 * Currently only the NullAdapter is active.
 * Add WhatsAppAdapter, SlackAdapter, ResendEmailAdapter etc. as needed.
 */

import { NullAdapter, type NotificationAdapter } from "../adapter";

export const notificationAdapters: NotificationAdapter[] = [
  new NullAdapter(),
  // new WhatsAppAdapter(),
  // new SlackAdapter(),
  // new ResendEmailAdapter(),
];
