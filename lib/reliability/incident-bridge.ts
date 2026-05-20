/**
 * lib/reliability/incident-bridge.ts
 *
 * Bridges the Tier-4 alert evaluation engine to the existing
 * `system_incidents` table (migration 080).
 *
 * When evaluateAlerts() fires critical or warning events, this bridge
 * writes structured incident rows so they appear in:
 *   - The site-level RecentIncidentsTable
 *   - Future SLA / reporting queries
 *   - The unified degradation timeline
 *
 * Deduplication: one incident per (site_id, source_key, date-key).
 * This prevents a polling loop from spamming duplicate incidents.
 *
 * Deliberately non-blocking: uses fire-and-forget pattern for non-critical
 * writes. A bridge failure never prevents the caller from completing.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { AlertEvent }    from "@/lib/alerts/rules";
import { logger }             from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncidentBridgeResult {
  created: number;
  skipped: number;
}

// ── Source key ────────────────────────────────────────────────────────────────

/**
 * Build the dedup source key: `ops.{ruleKey}`.
 * Stored in `system_incidents.source` — enables dedup + querying by origin.
 */
function sourceKey(ruleKey: string): string {
  return `ops.${ruleKey.toLowerCase()}`;
}

// ── Dedup check ───────────────────────────────────────────────────────────────

/**
 * Returns true if an open/investigating incident from the same source
 * was already created today for this site.
 *
 * Uses service-role-compatible server client (caller guarantees context).
 */
async function isAlreadyOpen(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
  source: string,
  dateKey: string, // YYYY-MM-DD
): Promise<boolean> {
  try {
    const dayStart = `${dateKey}T00:00:00.000Z`;
    const dayEnd   = `${dateKey}T23:59:59.999Z`;

    const { data } = await (supabase as any)
      .from("system_incidents")
      .select("id")
      .eq("site_id", siteId)
      .eq("source", source)
      .in("status", ["open", "investigating"])
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .limit(1)
      .maybeSingle();

    return !!data;
  } catch (err) {
    logger.warn("incident-bridge.dedup_check_failed", { siteId, source, err: String(err) });
    return false; // fail open — better to create duplicate than to silence
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record system_incidents rows for all fired alerts.
 *
 * @param alerts   - From evaluateAlerts() — only fired alerts
 * @param siteId   - The site these alerts belong to
 * @returns        - { created, skipped } — number of new incidents vs. deduped
 *
 * Filters to `warning` and `critical` severity only — `info` alerts do not
 * become incidents.
 */
export async function recordIncidentForAlerts(
  alerts: AlertEvent[],
  siteId: string,
): Promise<IncidentBridgeResult> {
  const actionable = alerts.filter(
    (a) => a.severity === "warning" || a.severity === "critical",
  );

  if (actionable.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const supabase = createServerClient();
  const dateKey  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let created = 0;
  let skipped = 0;

  for (const alert of actionable) {
    const source = sourceKey(alert.ruleKey);

    try {
      // Dedup: skip if an open incident from this source already exists today
      const alreadyOpen = await isAlreadyOpen(supabase, siteId, source, dateKey);
      if (alreadyOpen) {
        skipped++;
        continue;
      }

      const { error } = await (supabase as any)
        .from("system_incidents")
        .insert({
          site_id:  siteId,
          source,
          severity: alert.severity,
          summary:  alert.message,
          status:   "open",
          details:  {
            ruleKey:     alert.ruleKey,
            label:       alert.label,
            triggeredAt: alert.triggeredAt,
            metadata:    alert.metadata ?? {},
            autoCreated: true,
          },
          created_at: alert.triggeredAt, // use the evaluation timestamp
        });

      if (error) {
        logger.warn("incident-bridge.insert_failed", { siteId, source, err: error.message });
        skipped++;
      } else {
        logger.info("incident-bridge.created", { siteId, source, severity: alert.severity });
        created++;
      }
    } catch (err) {
      logger.warn("incident-bridge.error", { siteId, source, err: String(err) });
      skipped++;
    }
  }

  return { created, skipped };
}
