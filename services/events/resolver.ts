/**
 * Event resolver: combines database events with computed recurring event logic.
 *
 * Rules:
 * - Quiz Night:  every 2nd Friday, starting 2026-03-13, interval 14 days
 * - Salsa Night: alternate Fridays (the Fridays that are NOT Quiz Night Fridays),
 *                starting 2026-03-20, interval 14 days
 * - Sip & Paint: fixed dates only (stored in database)
 *
 * Strategy:
 * 1. Load all events from the database for the window requested.
 * 2. Compute any recurring events not yet in the DB for the window.
 * 3. Merge, deduplicate, and respect `cancelled` flag from DB.
 */

import { addDays, parseISO, differenceInDays, format } from "date-fns";
import { createServerClient } from "@/lib/supabase/server";
import { ResolvedEvent, VenueEvent } from "@/types";
import {
  QUIZ_NIGHT_ANCHOR,
  QUIZ_NIGHT_INTERVAL_DAYS,
  SALSA_NIGHT_ANCHOR,
  SALSA_NIGHT_INTERVAL_DAYS,
} from "@/lib/constants";

// ============================================================
// Compute recurring event dates within a date window
// ============================================================

interface RecurringEventConfig {
  name: string;
  anchor: string;           // ISO date — first occurrence
  intervalDays: number;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
}

function computeRecurringDates(
  config: RecurringEventConfig,
  windowStart: Date,
  windowEnd: Date
): ResolvedEvent[] {
  const results: ResolvedEvent[] = [];
  const anchorDate = parseISO(config.anchor);
  const daysBetween = differenceInDays(windowStart, anchorDate);

  // Find the first occurrence on or after windowStart
  let occurrenceIndex = Math.max(0, Math.ceil(daysBetween / config.intervalDays));
  let current = addDays(anchorDate, occurrenceIndex * config.intervalDays);

  while (current <= windowEnd) {
    if (current >= windowStart) {
      results.push({
        name: config.name,
        event_date: format(current, "yyyy-MM-dd"),
        start_time: config.start_time,
        end_time: config.end_time,
        description: config.description,
        booking_enabled: true,
        source: "computed",
      });
    }
    current = addDays(current, config.intervalDays);
  }

  return results;
}

// ============================================================
// Fetch database events for a window
// ============================================================

async function fetchDbEvents(
  windowStart: string,
  windowEnd: string
): Promise<VenueEvent[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("event_date", windowStart)
    .lte("event_date", windowEnd)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("[EventResolver] DB fetch error:", error.message);
    return [];
  }

  return (data ?? []) as VenueEvent[];
}

// ============================================================
// Main resolver: upcoming events within the next N days
// ============================================================

export async function resolveUpcomingEvents(
  daysAhead: number = 30
): Promise<ResolvedEvent[]> {
  const today = new Date();
  const windowEnd = addDays(today, daysAhead);

  const windowStartStr = format(today, "yyyy-MM-dd");
  const windowEndStr   = format(windowEnd, "yyyy-MM-dd");

  // 1. Fetch from database
  const dbEvents = await fetchDbEvents(windowStartStr, windowEndStr);

  // Build a lookup: "EventName|YYYY-MM-DD" -> VenueEvent
  const dbLookup = new Map<string, VenueEvent>();
  for (const e of dbEvents) {
    dbLookup.set(`${e.name}|${e.event_date}`, e);
  }

  // 2. Compute recurring events
  const quizConfig: RecurringEventConfig = {
    name: "Quiz Night",
    anchor: QUIZ_NIGHT_ANCHOR,
    intervalDays: QUIZ_NIGHT_INTERVAL_DAYS,
    start_time: "19:00",
    end_time: "22:00",
    description: "Test your knowledge at our weekly trivia night. Teams of up to 6.",
  };

  const salsaConfig: RecurringEventConfig = {
    name: "Salsa Night",
    anchor: SALSA_NIGHT_ANCHOR,
    intervalDays: SALSA_NIGHT_INTERVAL_DAYS,
    start_time: "20:00",
    end_time: "23:30",
    description: "Live salsa music and dancing. All levels welcome.",
  };

  const quizComputed  = computeRecurringDates(quizConfig,  today, windowEnd);
  const salsaComputed = computeRecurringDates(salsaConfig, today, windowEnd);

  // 3. Merge: database record wins over computed
  const merged = new Map<string, ResolvedEvent>();

  // Add all non-cancelled DB events first
  for (const e of dbEvents) {
    if (e.cancelled) continue;
    const key = `${e.name}|${e.event_date}`;
    merged.set(key, {
      name: e.name,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      description: e.description,
      booking_enabled: e.booking_enabled,
      source: "database",
    });
  }

  // Add computed Quiz Night events (skip if DB has an entry — cancelled or overridden)
  for (const e of quizComputed) {
    const key = `${e.name}|${e.event_date}`;
    if (!dbLookup.has(key)) {
      merged.set(key, e);
    }
    // If DB says cancelled, it's already excluded above; computed wont override.
  }

  // Add computed Salsa Night events
  for (const e of salsaComputed) {
    const key = `${e.name}|${e.event_date}`;
    if (!dbLookup.has(key)) {
      merged.set(key, e);
    }
  }

  // 4. Sort by date
  return Array.from(merged.values()).sort((a, b) =>
    a.event_date.localeCompare(b.event_date)
  );
}

// ============================================================
// Resolve events for a specific date
// ============================================================

export async function resolveEventsForDate(
  dateStr: string
): Promise<ResolvedEvent[]> {
  const date = parseISO(dateStr);
  const today = new Date();
  // Always look at least 1 day ahead; for past dates look 0 days and filter from DB directly
  const daysAhead = Math.max(differenceInDays(date, today) + 1, 1);
  const all = await resolveUpcomingEvents(daysAhead);
  return all.filter((e) => e.event_date === dateStr);
}

// ============================================================
// Check if a named event occurs on a specific date
// ============================================================

export async function isEventOnDate(
  eventName: string,
  dateStr: string
): Promise<boolean> {
  const events = await resolveEventsForDate(dateStr);
  return events.some(
    (e) => e.name.toLowerCase() === eventName.toLowerCase()
  );
}
