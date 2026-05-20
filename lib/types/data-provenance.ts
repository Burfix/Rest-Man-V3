/**
 * lib/types/data-provenance.ts
 *
 * Shared data provenance contract used across all dashboard modules.
 *
 * Every operational metric surface should carry a DataProvenance object so
 * that users (and support engineers) can always answer:
 *   - Where did this data come from?
 *   - When was it last synced?
 *   - Is it stale?
 *   - Is it a fallback or estimate?
 *
 * This is the foundation of operational trust in multi-site SaaS.
 */

/**
 * The authoritative source of a data set.
 *
 * - live_micros    : fetched directly from Oracle MICROS for this site's loc_ref
 * - mock           : development-mode stub — never present in production
 * - no_connection  : site has no MICROS connection configured
 * - stale_fallback : live fetch failed or returned nothing; serving older cached data
 * - cached         : served from application cache; real source was live_micros
 * - manual_upload  : data came from a GM/operator CSV upload
 */
export type DataSource =
  | "live_micros"
  | "mock"
  | "no_connection"
  | "stale_fallback"
  | "cached"
  | "manual_upload";

export interface DataProvenance {
  /** Authoritative origin of the data. */
  source: DataSource;
  /**
   * ISO-8601 timestamp of when the data was fetched/synced.
   * Null means data has never been fetched (always treated as stale,
   * unless source is "no_connection").
   */
  fetchedAt: string | null;
  /**
   * True when the data is older than the declared SLA, or has never been
   * fetched. Always false for "no_connection" (N/A — not stale, just absent).
   */
  isStale: boolean;
  /** Oracle MICROS location reference used to fetch this data, if applicable. */
  locRef?: string;
  /** UUID of the site this data belongs to. */
  siteId: string;
  /** Human-readable explanation of why a non-live source was used. */
  reason?: string;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildDataProvenanceInput {
  source: DataSource;
  /**
   * When the data was fetched. Accepts ISO string, Date, or null.
   * Normalised to ISO string internally.
   */
  fetchedAt?: string | Date | null;
  /**
   * If provided, isStale is calculated as: (now - fetchedAt) > staleAfterMinutes.
   * If omitted and fetchedAt is non-null, isStale defaults to false
   * (fresh — no SLA declared).
   */
  staleAfterMinutes?: number;
  locRef?: string;
  siteId: string;
  reason?: string;
}

/**
 * Build a DataProvenance object with normalised fields and calculated staleness.
 *
 * Deterministic — safe to call in both server and client contexts.
 *
 * @example
 * ```ts
 * const provenance = buildDataProvenance({
 *   source: "live_micros",
 *   fetchedAt: summary.lastSyncAt,
 *   staleAfterMinutes: 60,
 *   locRef: connection.loc_ref,
 *   siteId,
 * });
 * ```
 */
export function buildDataProvenance(input: BuildDataProvenanceInput): DataProvenance {
  const { source, staleAfterMinutes, locRef, siteId, reason } = input;

  // ── Normalise fetchedAt to ISO string or null ─────────────────────────────
  let fetchedAt: string | null = null;
  if (input.fetchedAt instanceof Date) {
    fetchedAt = input.fetchedAt.toISOString();
  } else if (typeof input.fetchedAt === "string" && input.fetchedAt.length > 0) {
    fetchedAt = input.fetchedAt;
  }
  // undefined / empty string / null → null

  // ── Calculate isStale ─────────────────────────────────────────────────────
  let isStale: boolean;

  if (source === "no_connection") {
    // Not "stale" — the connection simply doesn't exist. Staleness is N/A.
    isStale = false;
  } else if (fetchedAt === null) {
    // No record of a successful fetch → always stale.
    isStale = true;
  } else if (staleAfterMinutes !== undefined) {
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    isStale = ageMs > staleAfterMinutes * 60_000;
  } else {
    // fetchedAt is present but no SLA defined — assume fresh.
    isStale = false;
  }

  return {
    source,
    fetchedAt,
    isStale,
    ...(locRef !== undefined ? { locRef } : {}),
    siteId,
    ...(reason !== undefined ? { reason } : {}),
  };
}
