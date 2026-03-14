// ============================================================
// Application-wide constants
// ============================================================

export const VENUE_NAME = "Si Cantina Sociale";
export const VENUE_LOCATION = "V&A Waterfront, Silo District, Cape Town";

export const MAX_CAPACITY = 200;
export const MAX_TABLE_SIZE = 100;
export const SERVICE_CHARGE_THRESHOLD = 8;

/** Quiz Night starts on 2026-03-13, repeats every 14 days (every 2nd Friday) */
export const QUIZ_NIGHT_ANCHOR = "2026-03-13";
export const QUIZ_NIGHT_INTERVAL_DAYS = 14;

/**
 * Salsa Night starts on 2026-03-20, repeats every 14 days
 * (alternate Fridays — i.e. the Fridays that do NOT have Quiz Night)
 */
export const SALSA_NIGHT_ANCHOR = "2026-03-20";
export const SALSA_NIGHT_INTERVAL_DAYS = 14;

export const OPENING_HOURS_LABEL = {
  weekdays: "08:30 – 21:30 (Sunday to Thursday)",
  weekends: "08:30 until late (Friday & Saturday)",
};

/** Number of recent conversation messages to include in AI context */
export const CONVERSATION_HISTORY_LIMIT = 10;

/** Escalation triggers */
export const ESCALATION_GUEST_THRESHOLD = 100;

// ============================================================
// Revenue Intelligence Engine
// ============================================================

/**
 * Revenue uplift multiplier per event type.
 * Keys must match event names exactly as stored in the events table.
 * Configurable — update these as you gather more accurate data.
 */
export const EVENT_REVENUE_MULTIPLIERS: Record<string, number> = {
  "Quiz Night":  1.15,
  "Salsa Night": 1.20,
  "Sip & Paint": 1.35,
};

/** Multiplier when no event is scheduled (identity) */
export const DEFAULT_EVENT_MULTIPLIER = 1.0;

/**
 * Fallback average spend per guest (ZAR, ex-VAT).
 * Used when no daily operations history is available.
 */
export const DEFAULT_AVG_SPEND_ZAR = 250;

/**
 * Fraction of the "gap" between recent avg covers and confirmed bookings
 * that is assumed to materialise as walk-in traffic.
 * e.g. 0.7 = 70 % of the unbooked historical average will walk in.
 */
export const WALKIN_COVER_RATIO = 0.7;

/** Risk threshold values — used in both service and component */
export const RISK = {
  LABOR_HIGH_PCT:      30,
  LABOR_MEDIUM_PCT:    20,
  MARGIN_LOW_PCT:       8,
  MARGIN_MEDIUM_PCT:   12,
  SALES_GAP_HIGH_PCT:  -15,  // negative = below target
  SALES_GAP_MEDIUM_PCT: -5,
  EVENT_LOW_FILL_RATIO: 0.70,
} as const;

/**
 * Fixed organisation ID for this single-tenant deployment.
 * Replace with a real UUID if multi-tenancy is ever added.
 */
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================
// Localisation
// ============================================================

/**
 * Currency symbol used in alert messages and UI labels.
 * Override via CURRENCY_SYMBOL env var when deploying outside South Africa.
 * Example: "£", "€", "$"
 */
export const CURRENCY_SYMBOL: string =
  process.env.CURRENCY_SYMBOL ?? "R";

// ============================================================
// Alert engine configuration
// ============================================================

/**
 * Maximum age (days) of a daily operations report before labor/margin
 * alert checks skip it as stale. Avoids firing alerts on weeks-old data.
 */
export const REPORT_MAX_AGE_DAYS = 7;

/**
 * Minimum number of reviews required in each comparison period before
 * the reputation-risk alert fires. Prevents single-review overreactions.
 */
export const MIN_REVIEW_SAMPLE = 3;
