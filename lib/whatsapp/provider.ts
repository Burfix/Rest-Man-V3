/**
 * lib/whatsapp/provider.ts
 *
 * WhatsApp delivery provider abstraction.
 *
 * Supports Meta WhatsApp Cloud API (default) or Twilio WhatsApp.
 * Selected via WHATSAPP_PROVIDER env var. Credentials are NEVER hardcoded.
 *
 * Usage:
 *   import { getWhatsAppProvider } from "@/lib/whatsapp/provider";
 *   const provider = getWhatsAppProvider();
 *   const result = await provider.sendTextMessage("+27821234567", "Hello");
 */

import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WhatsAppSendResult {
  /** Provider-assigned message ID (WAMID for Meta, MessageSid for Twilio) */
  messageId: string;
  /** Provider name used for this delivery */
  provider: "meta" | "twilio";
}

export interface WhatsAppProvider {
  /** Send a plain-text message to a WhatsApp number in E.164 format */
  sendTextMessage(to: string, body: string): Promise<WhatsAppSendResult>;
  /** True if all required env vars are present and the provider can send */
  isConfigured(): boolean;
}

// ── Meta WhatsApp Cloud API ───────────────────────────────────────────────────

class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion = "v20.0";

  constructor(accessToken: string, phoneNumberId: string) {
    this.accessToken    = accessToken;
    this.phoneNumberId  = phoneNumberId;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  async sendTextMessage(to: string, body: string): Promise<WhatsAppSendResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type:    "individual",
      to,
      type:              "text",
      text: { body, preview_url: false },
    };

    const res = await fetch(url, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      logger.error("[WhatsApp/Meta] sendTextMessage failed", {
        status: res.status,
        body:   text.slice(0, 400),
        to,
      });
      throw new WhatsAppDeliveryError(
        `Meta API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        "meta",
      );
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id ?? "";

    if (!messageId) {
      throw new WhatsAppDeliveryError(
        "Meta API returned 200 but no message ID in response",
        200,
        "meta",
      );
    }

    logger.info("[WhatsApp/Meta] message sent", { to, messageId });
    return { messageId, provider: "meta" };
  }
}

// ── Twilio WhatsApp ───────────────────────────────────────────────────────────

class TwilioWhatsAppProvider implements WhatsAppProvider {
  private readonly accountSid:  string;
  private readonly authToken:   string;
  private readonly fromNumber:  string; // e.g. whatsapp:+14155238886

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken  = authToken;
    this.fromNumber = fromNumber.startsWith("whatsapp:")
      ? fromNumber
      : `whatsapp:${fromNumber}`;
  }

  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromNumber);
  }

  async sendTextMessage(to: string, body: string): Promise<WhatsAppSendResult> {
    const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const params = new URLSearchParams({
      From: this.fromNumber,
      To:   toFormatted,
      Body: body,
    });

    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const res = await fetch(url, {
      method:  "POST",
      headers: {
        Authorization:  `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      logger.error("[WhatsApp/Twilio] sendTextMessage failed", {
        status: res.status,
        body:   text.slice(0, 400),
        to,
      });
      throw new WhatsAppDeliveryError(
        `Twilio API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        "twilio",
      );
    }

    const data = (await res.json()) as { sid?: string };
    const messageId = data.sid ?? "";

    if (!messageId) {
      throw new WhatsAppDeliveryError(
        "Twilio API returned 200 but no message SID in response",
        200,
        "twilio",
      );
    }

    logger.info("[WhatsApp/Twilio] message sent", { to, messageId });
    return { messageId, provider: "twilio" };
  }
}

// ── Error class ───────────────────────────────────────────────────────────────

export class WhatsAppDeliveryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly provider: "meta" | "twilio",
  ) {
    super(message);
    this.name = "WhatsAppDeliveryError";
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _provider: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (_provider) return _provider;

  const providerName = (process.env.WHATSAPP_PROVIDER ?? "meta").toLowerCase();

  if (providerName === "twilio") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
    const authToken  = process.env.TWILIO_AUTH_TOKEN?.trim()  ?? "";
    const fromNumber = process.env.WHATSAPP_FROM_NUMBER?.trim() ?? "";
    _provider = new TwilioWhatsAppProvider(accountSid, authToken, fromNumber);
    logger.info("[WhatsApp] Twilio provider initialised", {
      configured: _provider.isConfigured(),
    });
  } else {
    // Default: Meta WhatsApp Cloud API
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()    ?? "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
    _provider = new MetaWhatsAppProvider(accessToken, phoneNumberId);
    logger.info("[WhatsApp] Meta provider initialised", {
      configured: _provider.isConfigured(),
    });
  }

  return _provider;
}

/** Reset the cached provider — used in tests to pick up env var changes. */
export function resetWhatsAppProvider(): void {
  _provider = null;
}
