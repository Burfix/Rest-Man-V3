/**
 * Booking service: CRUD operations for reservations and conversation logs.
 */

import { createServerClient } from "@/lib/supabase/server";
import { BookingDraft, ConversationLog, Reservation } from "@/types";
import { SERVICE_CHARGE_THRESHOLD } from "@/lib/constants";

/** Today as YYYY-MM-DD in Africa/Johannesburg timezone */
function todaySAST(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg",
  });
}

// ============================================================
// Create a new reservation
// ============================================================

export async function createReservation(
  draft: BookingDraft,
  escalationRequired: boolean = false,
  sourceChannel: string = "whatsapp",
  allowPastDates: boolean = false
): Promise<Reservation> {
  // --- Hard validation before any DB write ---
  if (!draft.customer_name?.trim()) {
    throw new Error("[BookingService] customer_name is required");
  }
  if (!draft.booking_date?.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error("[BookingService] booking_date must be YYYY-MM-DD format");
  }
  if (!draft.booking_time?.trim()) {
    throw new Error("[BookingService] booking_time is required");
  }
  const guestCount = Number(draft.guest_count);
  if (!Number.isInteger(guestCount) || guestCount < 1) {
    throw new Error("[BookingService] guest_count must be a positive integer");
  }

  // Reject past dates — compare against SAST midnight to avoid UTC bleed
  // (skipped for import/bulk-sync where historical records are acceptable)
  if (!allowPastDates) {
    const todayStr = todaySAST();
    const [ty, tm, td] = todayStr.split("-").map(Number);
    const today = new Date(Date.UTC(ty, tm - 1, td));
    const [year, month, day] = draft.booking_date.split("-").map(Number);
    const bookingDay = new Date(Date.UTC(year, month - 1, day));
    if (bookingDay < today) {
      throw new Error(
        `[BookingService] booking_date ${draft.booking_date} is in the past`
      );
    }
  }

  const supabase = createServerClient();
  const serviceChargeApplies = guestCount > SERVICE_CHARGE_THRESHOLD;

  const payload = {
    customer_name:          draft.customer_name.trim(),
    phone_number:           draft.phone_number,
    booking_date:           draft.booking_date,
    booking_time:           draft.booking_time.trim(),
    guest_count:            guestCount,
    event_name:             draft.event_name   ?? null,
    special_notes:          draft.special_notes ?? null,
    status:                 "pending" as const,
    service_charge_applies: serviceChargeApplies,
    escalation_required:    escalationRequired,
    source_channel:         sourceChannel,
  };

  const { data, error } = await supabase
    .from("reservations")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`[BookingService] Failed to create reservation: ${error.message}`);
  }

  return data as Reservation;
}

// ============================================================
// Update reservation status
// ============================================================

export async function updateReservationStatus(
  id: string,
  status: Reservation["status"]
): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id);

  if (error) {
    throw new Error(`[BookingService] Failed to update reservation: ${error.message}`);
  }
}

// ============================================================
// Fetch a single reservation by ID
// ============================================================

export async function getReservationById(id: string): Promise<Reservation | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`[BookingService] Failed to fetch reservation: ${error.message}`);
  }

  return data as Reservation | null;
}

// ============================================================
// Fetch all reservations (for dashboard)
// ============================================================

export async function getReservations(options?: {
  date?: string;
  escalationOnly?: boolean;
  upcomingOnly?: boolean;
  limit?: number;
}): Promise<Reservation[]> {
  const supabase = createServerClient();

  let query = supabase
    .from("reservations")
    .select("*")
    .order("booking_date", { ascending: true })
    .order("booking_time", { ascending: true });

  if (options?.date) {
    query = query.eq("booking_date", options.date);
  }

  if (options?.upcomingOnly) {
    query = query.gte("booking_date", todaySAST()).neq("status", "cancelled");
  }

  if (options?.escalationOnly) {
    query = query.eq("escalation_required", true);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`[BookingService] Failed to fetch reservations: ${error.message}`);
  }

  return (data ?? []) as Reservation[];
}

// ============================================================
// Fetch upcoming reservations (today onward)
// ============================================================

export async function getUpcomingReservations(): Promise<Reservation[]> {
  const supabase = createServerClient();
  const today = todaySAST();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .gte("booking_date", today)
    .neq("status", "cancelled")
    .order("booking_date", { ascending: true })
    .order("booking_time", { ascending: true });

  if (error) {
    throw new Error(`[BookingService] Failed to fetch upcoming reservations: ${error.message}`);
  }

  return (data ?? []) as Reservation[];
}

// ============================================================
// Fetch today's reservations
// ============================================================

export async function getTodaysReservations(): Promise<Reservation[]> {
  const supabase = createServerClient();
  const today = todaySAST();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("booking_date", today)
    .neq("status", "cancelled")
    .order("booking_time", { ascending: true });

  if (error) {
    throw new Error(`[BookingService] Failed to fetch today's reservations: ${error.message}`);
  }

  return (data ?? []) as Reservation[];
}

// ============================================================
// Conversation log
// ============================================================

export async function logConversationTurn(params: {
  phone_number: string;
  user_message: string;
  assistant_message: string | null;
  extracted_intent: string | null;
  /** Pass null explicitly to CLEAR the draft state (e.g. after a booking is saved) */
  extracted_booking_data_json: Partial<BookingDraft> | null;
  escalation_required: boolean;
  /** WhatsApp message ID — stored for idempotent deduplication */
  wa_message_id?: string | null;
}): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase.from("conversation_logs").insert({
    phone_number:                params.phone_number,
    user_message:                params.user_message,
    assistant_message:           params.assistant_message,
    extracted_intent:            params.extracted_intent,
    extracted_booking_data_json: params.extracted_booking_data_json,
    escalation_required:         params.escalation_required,
    wa_message_id:               params.wa_message_id ?? null,
  });

  if (error) {
    // Non-fatal — logging failure must never crash the booking flow
    console.error("[BookingService] Failed to log conversation:", error.message);
  }
}

// ============================================================
// Deduplication: has this WhatsApp message already been processed?
// ============================================================

export async function isAlreadyProcessed(waMessageId: string): Promise<boolean> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("conversation_logs")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .limit(1)
    .maybeSingle();

  if (error) {
    // If we can't check, assume not processed so we do not silently swallow messages
    console.error("[BookingService] Dedup check failed:", error.message);
    return false;
  }

  return !!data;
}

// ============================================================
// Retrieve recent conversation history for a phone number
// ============================================================

export async function getConversationHistory(
  phoneNumber: string,
  limit: number = 10
): Promise<Pick<ConversationLog, "user_message" | "assistant_message">[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("conversation_logs")
    .select("user_message, assistant_message")
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[BookingService] Failed to fetch conversation history:", error.message);
    return [];
  }

  // Reverse to chronological order for AI context
  return ((data ?? []) as Pick<ConversationLog, "user_message" | "assistant_message">[]).reverse();
}

// ============================================================
// Retrieve the most recent booking draft for a phone number.
//
// IMPORTANT: This fetches the single most-recent log entry
// (including ones with null draft). A null draft in the latest
// entry means the booking state was explicitly cleared — the
// webhook does this after a booking is successfully saved.
// Do NOT add a `.not(null)` filter here.
// ============================================================

export async function getLatestBookingDraft(
  phoneNumber: string
): Promise<Partial<BookingDraft> | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("conversation_logs")
    .select("extracted_booking_data_json")
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[BookingService] Failed to fetch latest booking draft:", error.message);
    return null;
  }

  if (!data) return null;

  return (data.extracted_booking_data_json as Partial<BookingDraft> | null) ?? null;
}
