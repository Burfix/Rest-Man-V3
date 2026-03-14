/**
 * WhatsApp Cloud API Webhook
 *
 * GET  /api/webhooks/whatsapp  — Hub verification handshake
 * POST /api/webhooks/whatsapp  — Inbound message handler
 *
 * Flow:
 * 1. Parse the inbound WhatsApp message
 * 2. Retrieve recent conversation history for this number
 * 3. Run the AI turn (intent + extraction + reply)
 * 4. If booking is complete, save reservation to Supabase
 * 5. Send the AI reply back via WhatsApp
 * 6. Log the conversation turn
 */

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
  isAlreadyProcessed,
} from "@/services/bookings/service";
import { CONVERSATION_HISTORY_LIMIT } from "@/lib/constants";
import {
  sendBookingConfirmationEmail,
} from "@/services/notifications/confirmations";

// ============================================================
// GET — WhatsApp webhook verification
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;

  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.info("[WhatsApp Webhook] Verification successful");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[WhatsApp Webhook] Verification failed — token mismatch");
  return new NextResponse("Forbidden", { status: 403 });
}

// ============================================================
// POST — Inbound message handler
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // WhatsApp expects a 200 quickly — do not let errors return non-200
  try {
    const body = (await request.json()) as WhatsAppWebhookBody;

    // Parse the inbound payload
    const parsed = parseWebhookPayload(body);
    if (!parsed) {
      // Status update or unsupported message type — ack and ignore
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const { from: phoneNumber, messageId, text: userMessage } = parsed;

    // --------------------------------------------------------
    // Idempotency guard: skip already-processed messages.
    // WhatsApp retries delivery if it does not receive a 200
    // within ~15 seconds. Our OpenAI + DB round-trips can exceed
    // that. Without this guard, retries create duplicate bookings.
    // --------------------------------------------------------
    const alreadyProcessed = await isAlreadyProcessed(messageId);
    if (alreadyProcessed) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    // Mark as read (non-blocking)
    markMessageAsRead(messageId).catch(() => {});

    // --------------------------------------------------------
    // Retrieve recent conversation history
    // --------------------------------------------------------
    const rawHistory = await getConversationHistory(
      phoneNumber,
      CONVERSATION_HISTORY_LIMIT
    );

    const conversationHistory: ConversationMessage[] = rawHistory.flatMap((turn) => {
      const messages: ConversationMessage[] = [
        { role: "user", content: turn.user_message },
      ];
      if (turn.assistant_message) {
        messages.push({ role: "assistant", content: turn.assistant_message });
      }
      return messages;
    });

    // --------------------------------------------------------
    // Load existing booking draft from latest conversation log.
    // getLatestBookingDraft returns null if the latest log entry
    // has a null draft (i.e. draft was cleared after booking save).
    // --------------------------------------------------------
    const existingDraft: Partial<BookingDraft> = (await getLatestBookingDraft(phoneNumber)) ?? {};

    // --------------------------------------------------------
    // Run the AI turn
    // --------------------------------------------------------
    const result = await runAiTurn(
      userMessage,
      phoneNumber,
      conversationHistory,
      existingDraft
    );

    // --------------------------------------------------------
    // If booking is complete, save to database BEFORE sending reply.
    // If save fails, override the reply with an apology — because
    // the AI already said "I'm securing your table now" and we must
    // not leave the customer falsely confirmed with no DB record.
    // --------------------------------------------------------
    let finalReply = result.reply;
    let draftForLog: Partial<BookingDraft> | null = result.bookingDraft;

    if (result.bookingComplete && result.bookingDraft) {
      try {
        const reservation = await createReservation(
          result.bookingDraft as BookingDraft,
          result.escalationRequired
        );
        console.info(
          `[WhatsApp Webhook] Booking created: ${reservation.id} for ${phoneNumber}`
        );
        // Send staff + guest email confirmation (non-blocking)
        sendBookingConfirmationEmail(reservation, null).catch(() => {});
        // Clear the draft so subsequent messages start a fresh booking flow.
        // getLatestBookingDraft checks the most-recent log entry; null here
        // means the slot is clean for the next conversation.
        draftForLog = null;
      } catch (bookingError) {
        const errMsg = bookingError instanceof Error ? bookingError.message : String(bookingError);
        console.error("[WhatsApp Webhook] Booking save failed:", errMsg);
        finalReply =
          "I'm sorry — I couldn't secure your booking right now. Please try again or call us directly. We apologise for the inconvenience!";
        // Keep the draft intact so the customer can retry without re-entering all details
        draftForLog = result.bookingDraft;
      }
    }

    // --------------------------------------------------------
    // Send reply via WhatsApp
    // --------------------------------------------------------
    try {
      await sendWhatsAppMessage(phoneNumber, finalReply);
    } catch (sendError) {
      console.error("[WhatsApp Webhook] Failed to send reply:", sendError);
      // We still log the turn — the booking may have been saved.
      // The customer will not see the reply but we have the record.
    }

    // --------------------------------------------------------
    // Log the conversation turn.
    // Always log with the wa_message_id so the dedup guard works.
    // --------------------------------------------------------
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
    console.error("[WhatsApp Webhook] Unhandled error:", error);
    // Still return 200 to prevent WhatsApp retrying on a real error
    return NextResponse.json(
      { status: "error", message: "Internal error" },
      { status: 200 }
    );
  }
}

// getLatestBookingDraft is now in services/bookings/service.ts
