import OpenAI from "openai";
import { ExtractionResult, ConversationIntent, ConversationMessage } from "@/types";
import { BOOKING_EXTRACTION_PROMPT, INTENT_CLASSIFICATION_PROMPT } from "./prompt";
import { todayISO } from "@/lib/utils";

// ============================================================
// OpenAI client (singleton)
// ============================================================

let _openai: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable");
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

// ============================================================
// Intent classification
// ============================================================

export async function classifyIntent(
  message: string
): Promise<ConversationIntent> {
  const openai = getOpenAIClient();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 50,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { intent?: string };

    const validIntents: ConversationIntent[] = [
      "ask_opening_hours",
      "ask_events",
      "make_booking",
      "private_event_enquiry",
      "complaint",
      "greeting",
      "unknown",
    ];

    const intent = parsed.intent as ConversationIntent;
    return validIntents.includes(intent) ? intent : "unknown";
  } catch {
    return "unknown";
  }
}

// ============================================================
// Booking field extraction
// ============================================================

export async function extractBookingFields(
  conversationHistory: ConversationMessage[]
): Promise<ExtractionResult> {
  const openai = getOpenAIClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${BOOKING_EXTRACTION_PROMPT}\n\nToday's date is ${todayISO()}.`,
    },
    ...conversationHistory.map(
      (m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })
    ),
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<ExtractionResult>;

    return {
      customer_name: parsed.customer_name ?? null,
      booking_date: parsed.booking_date ?? null,
      booking_time: parsed.booking_time ?? null,
      guest_count: parsed.guest_count != null ? Number(parsed.guest_count) : null,
      event_name: parsed.event_name ?? null,
      special_notes: parsed.special_notes ?? null,
    };
  } catch {
    return {
      customer_name: null,
      booking_date: null,
      booking_time: null,
      guest_count: null,
      event_name: null,
      special_notes: null,
    };
  }
}

// ============================================================
// Core conversational reply generation
// ============================================================

export async function generateReply(
  systemPrompt: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  const openai = getOpenAIClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map(
      (m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })
    ),
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.4,
    max_tokens: 400,
  });

  return response.choices[0]?.message?.content?.trim() ?? "I'm sorry, I couldn't process your message right now. Please try again.";
}
