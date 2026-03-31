/**
 * Sports Events Calendar — Si Cantina Revenue Uplift Intelligence
 *
 * Tracks known high-impact events that drive watch-party and occasion-dining
 * revenue at Si Cantina Sociale. Provides uplift multipliers for the
 * forecasting engine and brain voice line.
 *
 * HISTORICAL CALIBRATION:
 *   Sep 2024: Springbok CT home series → +44% revenue vs average September.
 *   This is the anchor for all Springbok CT uplift estimates.
 *
 * USAGE:
 *   eventUpliftFactor(date, siteId, dbEvents) — pure sync function
 *   dbEvents are loaded from site_events table by the caller (operating-brain)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventCategory =
  | "springbok_home_ct"    // Springbok home test in Cape Town (DHL Newlands)
  | "rugby_world_cup_sa"   // Rugby World Cup — SA playing any venue
  | "afcon_bafana"         // AFCON / Bafana Bafana major matches
  | "dstv_premier_ct"      // DStv Premiership: CT City or Stellenbosch derbies
  | "custom";              // Admin-entered event (uplift set manually)

export type SportsEvent = {
  /** ISO date "YYYY-MM-DD" */
  date: string;
  /** Display name shown in UI and voice line */
  name: string;
  category: EventCategory;
  /**
   * Revenue uplift multiplier (applied to projected close).
   * 1.0 = no change. 1.44 = +44% (Sep 2024 calibration).
   */
  upliftMultiplier: number;
  /** Restricts event to a specific site. Undefined = applies to all sites. */
  siteId?: string;
  /** false = tentative/scheduled, true = confirmed */
  confirmed: boolean;
  notes?: string;
};

// ── Default uplifts by category ───────────────────────────────────────────────

/**
 * Conservative midpoints within the stated ranges.
 * Adjust with site-specific data as more seasons are observed.
 */
export const CATEGORY_UPLIFT: Record<EventCategory, number> = {
  springbok_home_ct:  1.40,   // range 1.35–1.50; calibrated from Sep 2024 (+44%)
  rugby_world_cup_sa: 1.40,   // RWC SA matches — comparable to CT home games
  afcon_bafana:       1.20,   // AFCON / Bafana — broad audience, moderate uplift
  dstv_premier_ct:    1.15,   // Derby days — local crowd, pre and post-match
  custom:             1.0,    // Admin sets their own multiplier
};

// ── Seeded known events ───────────────────────────────────────────────────────

/**
 * Historical calibration anchors and upcoming confirmed fixtures.
 *
 * Historical entries are NOT removed once past — they serve as the
 * evidence base for future uplift estimates (confidence calibration).
 *
 * IMPORTANT: Springbok CT home fixtures beyond 2024 must be added
 * via the admin UI (/dashboard/settings → Upcoming Events) as fixture
 * lists are confirmed by SA Rugby.
 *
 * Sep 2024 is modelled as two watch-party dates within the home series.
 * The full +44% monthly swing was driven by the watch party atmosphere
 * across multiple weekends — tag individual dates as they are confirmed.
 */
export const SEEDED_EVENTS: SportsEvent[] = [
  // ── Sep 2024 Springbok CT home series — calibration anchor ───────────────
  {
    date: "2024-09-07",
    name: "Springbok Home Test — Sep 2024 (Match 1)",
    category: "springbok_home_ct",
    upliftMultiplier: 1.44,
    confirmed: true,
    notes:
      "Calibration anchor. Sep 2024 total revenue R931K (+44% vs avg Sep). " +
      "Watch party uplift across both weekend fixtures.",
  },
  {
    date: "2024-09-21",
    name: "Springbok Home Test — Sep 2024 (Match 2)",
    category: "springbok_home_ct",
    upliftMultiplier: 1.44,
    confirmed: true,
    notes: "Sep 2024 Springbok series — second watch party weekend.",
  },
];

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Get the revenue uplift factor and event name for a given date.
 *
 * Checks seeded events first, then any admin-entered events passed in via
 * dbEvents. When multiple events fall on the same date, the highest
 * uplift multiplier is used.
 *
 * Returns multiplier = 1.0 and eventName = null when no event is found.
 *
 * @param date      ISO "YYYY-MM-DD" to check
 * @param siteId    Optional — used to filter site-specific events
 * @param dbEvents  Events loaded from site_events table by the caller
 */
export function eventUpliftFactor(
  date: string,
  siteId?: string,
  dbEvents: SportsEvent[] = [],
): {
  multiplier: number;
  eventName: string | null;
  category: EventCategory | null;
} {
  const allEvents = [...SEEDED_EVENTS, ...dbEvents];

  const todayEvents = allEvents.filter((e) => {
    if (e.date !== date) return false;
    // Site-specific events: only include if siteId matches or event is global
    if (e.siteId && siteId && e.siteId !== siteId) return false;
    return true;
  });

  if (todayEvents.length === 0) {
    return { multiplier: 1.0, eventName: null, category: null };
  }

  // Use the event with the highest uplift multiplier
  const top = todayEvents.reduce((best, e) =>
    e.upliftMultiplier > best.upliftMultiplier ? e : best,
  );

  return {
    multiplier: top.upliftMultiplier,
    eventName:  top.name,
    category:   top.category,
  };
}

/**
 * Returns true if there are any confirmed seeded events in September
 * for the given year — used to decide whether September SDLY needs
 * the anomaly adjustment (Aug/Oct average fallback).
 */
export function hasSeptemberEventSeed(year: number): boolean {
  const prefix = `${year}-09`;
  return SEEDED_EVENTS.some(
    (e) => e.date.startsWith(prefix) && e.confirmed && e.category === "springbok_home_ct",
  );
}
