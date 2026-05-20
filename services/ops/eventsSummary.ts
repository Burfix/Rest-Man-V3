/**
 * Events summary service — upcoming events for the dashboard.
 */

import { createServerClient } from "@/lib/supabase/server";
import { VenueEvent } from "@/types";
import { todayISO } from "@/lib/utils";

export async function getUpcomingEvents(limit = 6): Promise<VenueEvent[]> {
  const supabase = createServerClient();
  const today = todayISO();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("event_date", today)
    .eq("cancelled", false)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(`[OpsSvc/Events] ${error.message}`);
  }

  return (data ?? []) as VenueEvent[];
}
