/**
 * Parses inbound WhatsApp Cloud API webhook payloads.
 * Returns a normalised message object or null if the payload
 * contains no actionable user message (e.g. status updates).
 */

import {
  WhatsAppWebhookBody,
  WhatsAppMessage,
  WhatsAppContact,
} from "@/types";

export interface ParsedInboundMessage {
  from: string;           // phone number (E.164 without +)
  messageId: string;
  displayName: string;
  text: string;
  timestamp: string;
}

export function parseWebhookPayload(
  body: WhatsAppWebhookBody
): ParsedInboundMessage | null {
  try {
    const entry  = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    if (!value || change?.field !== "messages") return null;

    const messages: WhatsAppMessage[] = value.messages ?? [];
    const contacts: WhatsAppContact[] = value.contacts ?? [];

    // We only handle text messages; ignore status updates, media, etc.
    const message = messages.find((m) => m.type === "text");
    if (!message || !message.text?.body) return null;

    const contact = contacts.find((c) => c.wa_id === message.from);
    const displayName = contact?.profile?.name ?? message.from;

    return {
      from:        message.from,
      messageId:   message.id,
      displayName,
      text:        message.text.body.trim(),
      timestamp:   message.timestamp,
    };
  } catch (err) {
    console.error("[WhatsApp Parser] Failed to parse webhook payload:", err);
    return null;
  }
}
