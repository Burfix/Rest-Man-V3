/**
 * WhatsApp Cloud API Webhook
 *
 * GET  /api/webhooks/whatsapp  — Hub verification handshake
 * POST /api/webhooks/whatsapp  — Inbound message handler
 *
 * Security:
 *   1. X-Hub-Signature-256 HMAC verification — rejects requests not from Meta
 *   2. Payload size guard — rejects oversized payloads before AI pipeline
 *   3. Atomic idempotency via processed_webhook_ids INSERT — prevents duplicate
 *      bookings on Meta retries (race-condition-safe, unlike SELECT-then-log)
 *   4. Request ID on all log lines for traceability
 *
 * Required env vars:
 *   META_APP_SECRET           — Meta Developer Console → App → Settings → Basic
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { WhatsAppWebhookBody, BookingDraft, ConversationMessage } from "@/types";
import { parseWebhookPayload } from "@/services/whatsapp/parser";
import { sendWhatsAppMessage, markMessageAsRead } from "@/services/whatsapp/client";
import { runAiTurn } from "@/services/ai/orchestration";
import {
  createReservation,
  logConversationTurn,
  getConversationHistory,
  getLatestBookingDraft,
} from "@/services/bookings/service";
import { CONVERSATION_HISTORY_LIMIT } from "@/lib/constants";
import { sendBookingConfirmationEmail } from "@/services/notifications/confirmations";
import { createServerClient } from "@/lib/supabase/server";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_BYTES = 64 * 1024  // 64KB — Meta payloads are never this large legitimately

// ─── SIGNATURE VERIFICATION ───────────────────────────────────────────────────

/**
 * Verifies the X-Hub-Signature-256 header from Meta.
 * Uses timing-safe comparison to prevent timing attacks.
 * Meta signs the raw body with your App Secret using HMAC-SHA256.
 */
async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[webhook] META_APP_SECRET not set — rejecting all requests in production");
      return false;
    }
    console.warn("[webhook] META_APP_SECRET not set — skipping signature check (dev only)");
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(7);  // strip 'sha256=' prefix
  const computedSignature = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const expected = Buffer.from(expectedSignature, "hex");
    const computed = Buffer.from(computedSignature, "hex");
    if (expected.length !== computed.length) return false;
    return timingSafeEqual(expected, computed);
  } catch {
    return false;
  }
}

// ─── IDEMPOTENCY ──────────────────────────────────────────────────────────────

/**
 * Atomically marks a message ID as processed.
 * Returns true if the message was already processed (INSERT hit unique conflict).
 *
 * Using INSERT ON CONFLICT is race-condition-safe: two concurrent retries from Meta
 * both attempt the insert — exactly one wins, the other gets a 23505 unique violation.
 * The old SELECT-from-conversation_logs approach had a TOCTOU gap.
 *
 * Requires migration 041_webhook_idempotency.sql to be applied.
 */
async function markAsProcessed(messageId: string): Promise<boolean> {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("processed_webhook_ids" as any)
      .insert({ message_id: messageId, created_at: new Date().toISOString() });

    if (error?.code === "23505") {
      return true;  // already processed
    }
    return false;
  } catch {
    // Table doesn't exist yet — skip dedup rather than crash.
    // Apply migration 041_webhook_idempotency.sql to enable.
    return false;
  }
}

// ─── GET — WhatsApp webhook verification ─────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;

  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.info("[webhook] Meta verification challenge passed");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[webhook] Meta verification challenge failed", { mode });
  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST — Inbound message handler ──────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    // ── 1. Payload size guard ───────────────────────────────────────────────
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      console.warn("[webhook] Oversized payload rejected", { requestId, contentLength });
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    // ── 2. Read raw body (must happen before signature verification) ────────
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch (err) {
      console.error("[webhook] Failed to read body", { requestId, err });
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    if (!rawBody) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // ── 3. HMAC signature verification ─────────────────────────────────────
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const signatureValid = await verifyMetaSignature(rawBody, signatureHeader);

    if (!signatureValid) {
      console.error("[webhook] Signature verification failed — request rejected", {
        requestId,
        hasSignatureHeader: !!signatureHeader,
        ip: request.headers.get("x-forwarded-for") ?? "unknown",
      });
      // Return 200 to prevent Meta retry storms; change to 401 once verified working
      return NextResponse.json({ status: "rejected" }, { status: 200 });
    }

    // ── 4. Parse payload ────────────────────────────────────────────────────
    let body: WhatsAppWebhookBody;
    try {
      body = JSON.parse(rawBody) as WhatsAppWebhookBody;
    } catch {
      console.error("[webhook] JSON parse failed", { requestId });
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // ── 5. Parse WhatsApp message ───────────────────────────────────────────
    const parsed = parseWebhookPayload(body);
    if (!parsed) {
      // Status update or unsupported message type — ack and ignore
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const { from: phoneNumber, messageId, text: userMessage } = parsed;

    // ── 6. Atomic idempotency check ─────────────────────────────────────────
    // INSERT wins = first time we see this message. Unique conflict = duplicate.
    const alreadyProcessed = await markAsProcessed(messageId);
    if (alreadyProcessed) {
      console.log("[webhook] Duplicate message — skipping", { requestId, messageId });
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    // Mark as read (non-blocking)
    markMessageAsRead(messageId).catch(() => {});

    // ── 7. Retrieve conversation history ────────────────────────────────────
    const rawHistory = await getConversationHistory(phoneNumber, CONVERSATION_HISTORY_LIMIT);

    const conversationHistory: ConversationMessage[] = rawHistory.flatMap((turn) => {
      const messages: ConversationMessage[] = [
        { role: "user", content: turn.user_message },
      ];
      if (turn.assistant_message) {
        messages.push({ role: "assistant", content: turn.assistant_message });
      }
      return messages;
    });

    // ── 8. Load existing booking draft ──────────────────────────────────────
    const existingDraft: Partial<BookingDraft> = (await getLatestBookingDraft(phoneNumber)) ?? {};

    // ── 9. Run the AI turn ──────────────────────────────────────────────────
    const result = await runAiTurn(userMessage, phoneNumber, conversationHistory, existingDraft);

    // ── 10. Save booking if complete ────────────────────────────────────────
    // Save BEFORE sending reply. If save fails, override reply with an apology —
    // because the AI already said "securing your table" and we must not leave
    // the guest falsely confirmed with no DB record.
    let finalReply = result.reply;
    let draftForLog: Partial<BookingDraft> | null = result.bookingDraft;

    if (result.bookingComplete && result.bookingDraft) {
      try {
        const reservation = await createReservation(
          result.bookingDraft as BookingDraft,
          result.escalationRequired,
        );
        console.info("[webhook] Booking created", { requestId, reservationId: reservation.id, phoneNumber });
        sendBookingConfirmationEmail(reservation, null).catch(() => {});
        draftForLog = null;  // clear draft so next message starts fresh
      } catch (bookingError) {
        const errMsg = bookingError instanceof Error ? bookingError.message : String(bookingError);
        console.error("[webhook] Booking save failed", { requestId, errMsg });
        finalReply =
          "I'm sorry — I couldn't secure your booking right now. Please try again or call us directly. We apologise for the inconvenience!";
        draftForLog = result.bookingDraft;  // keep draft so guest can retry
      }
    }

    // ── 11. Send reply ──────────────────────────────────────────────────────
    try {
      await sendWhatsAppMessage(phoneNumber, finalReply);
    } catch (sendError) {
      console.error("[webhook] Failed to send reply", { requestId, sendError });
    }

    // ── 12. Log conversation turn ───────────────────────────────────────────
    await logConversationTurn({
      phone_number:                phoneNumber,
      user_message:                userMessage,
      assistant_message:           finalReply,
      extracted_intent:            result.intent,
      extracted_booking_data_json: draftForLog,
      escalation_required:         result.escalationRequired,
      wa_message_id:               messageId,
    });

    return NextResponse.json({ status: "ok" }, { status: 200 });

  } catch (error) {
    console.error("[webhook] Unhandled error", { requestId: "unknown", error });
    // Return 200 — a 5xx causes Meta to retry and can create a retry storm
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
