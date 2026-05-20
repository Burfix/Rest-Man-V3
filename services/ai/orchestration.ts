/**
 * AI orchestration: receives an inbound WhatsApp message + conversation history,
 * returns a structured AiTurnResult that the webhook handler can act on.
 */
import {
  AiTurnResult,
  BookingDraft,
  ConversationMessage,
  ExtractionResult,
  REQUIRED_BOOKING_FIELDS,
} from "@/types";
import { classifyIntent, extractBookingFields, generateReply } from "./extraction";
import { buildSystemPrompt } from "./prompt";
import { resolveUpcomingEvents } from "@/services/events/resolver";
import { formatDisplayDate } from "@/lib/utils";
import { SERVICE_CHARGE_THRESHOLD, ESCALATION_GUEST_THRESHOLD } from "@/lib/constants";

// ============================================================
// Build event context block for the system prompt
// ============================================================

async function buildEventContextBlock(): Promise<string> {
  const events = await resolveUpcomingEvents(30); // next 30 days

  if (events.length === 0) {
    return "No upcoming events in the next 30 days.";
  }

  return events
    .map(
      (e) =>
        `• ${e.name} — ${formatDisplayDate(e.event_date)}` +
        (e.start_time ? `, from ${e.start_time}` : "") +
        (e.end_time ? ` to ${e.end_time}` : "") +
        (e.description ? `\n  ${e.description}` : "") +
        (!e.booking_enabled ? " (booking enquiries: contact team)" : "")
    )
    .join("\n");
}

// ============================================================
// Merge extracted fields into existing draft
// ============================================================

function mergeDraft(
  existing: Partial<BookingDraft>,
  extracted: ExtractionResult,
  phoneNumber: string
): Partial<BookingDraft> {
  const merged: Partial<BookingDraft> = { ...existing };

  if (extracted.customer_name) merged.customer_name = extracted.customer_name;
  if (extracted.booking_date)  merged.booking_date  = extracted.booking_date;
  if (extracted.booking_time)  merged.booking_time  = extracted.booking_time;
  if (extracted.guest_count != null) merged.guest_count = extracted.guest_count;
  if (extracted.event_name)    merged.event_name    = extracted.event_name;
  if (extracted.special_notes) merged.special_notes = extracted.special_notes;

  // Always carry the caller's phone number
  merged.phone_number = phoneNumber;

  return merged;
}

// ============================================================
// Determine if all required fields are collected
// ============================================================

function isDraftComplete(draft: Partial<BookingDraft>): draft is BookingDraft {
  return REQUIRED_BOOKING_FIELDS.every(
    (field) => draft[field] !== undefined && draft[field] !== null
  );
}

// ============================================================
// Determine if escalation is required
//
// Only definitive intents and guest count trigger hard escalation.
// "unknown" intent does NOT auto-escalate — the AI reply handles
// ambiguous messages. Escalating every "Hi" is not acceptable.
// ============================================================

function shouldEscalate(
  intent: AiTurnResult["intent"],
  draft: Partial<BookingDraft>
): boolean {
  // Definitive escalation intents
  if (intent === "private_event_enquiry" || intent === "complaint") {
    return true;
  }
  // Oversized groups need manager coordination
  if ((draft.guest_count ?? 0) > ESCALATION_GUEST_THRESHOLD) {
    return true;
  }
  return false;
}

// ============================================================
// Main orchestration entry point
// ============================================================

export async function runAiTurn(
  inboundMessage: string,
  phoneNumber: string,
  conversationHistory: ConversationMessage[],
  existingDraft: Partial<BookingDraft>
): Promise<AiTurnResult> {
  // 1. Classify intent (fast gpt-4o-mini call)
  const intent = await classifyIntent(inboundMessage);

  // 2. Build full message history for AI context
  const fullHistory: ConversationMessage[] = [
    ...conversationHistory,
    { role: "user", content: inboundMessage },
  ];

  // 3. Extract booking fields ONLY for booking-related turns.
  //    Skipping extraction for greetings and info-only queries saves
  //    a round-trip to OpenAI and avoids ghost field injection.
  const shouldExtract = intent === "make_booking" || intent === "unknown";
  const extracted = shouldExtract
    ? await extractBookingFields(fullHistory)
    : {
        customer_name: null,
        booking_date: null,
        booking_time: null,
        guest_count: null,
        event_name: null,
        special_notes: null,
      };

  // 4. Merge with existing draft (carried across conversation turns)
  const updatedDraft = mergeDraft(existingDraft, extracted, phoneNumber);

  // 5. Determine escalation
  const escalationRequired = shouldEscalate(intent, updatedDraft);

  // 6. Check service charge applicability
  const guestCount = updatedDraft.guest_count ?? 0;
  const serviceChargeApplies = guestCount > SERVICE_CHARGE_THRESHOLD;

  // 7. Check booking completeness (not applicable for escalations)
  const bookingComplete = !escalationRequired && isDraftComplete(updatedDraft);

  // 8. Build system prompt with event context
  //    Fetch event list for event queries and booking turns; skip for greetings/hours.
  const needsEventContext = intent === "ask_events" || intent === "make_booking" || intent === "unknown";
  const eventContext = needsEventContext
    ? await buildEventContextBlock()
    : "(event context omitted for this query type)";
  const systemPrompt = buildSystemPrompt(eventContext);

  // 9. Generate conversational reply
  const reply = await generateReply(systemPrompt, fullHistory);

  return {
    reply,
    intent,
    bookingDraft: Object.keys(updatedDraft).length > 0 ? updatedDraft : null,
    escalationRequired,
    bookingComplete,
    serviceChargeApplies,
  };
}
