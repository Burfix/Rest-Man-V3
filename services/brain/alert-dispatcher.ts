/**
 * services/brain/alert-dispatcher.ts
 *
 * Intelligence → Alert Bridge
 *
 * Connects BrainOutput (operating-brain.ts) to the Manager WhatsApp Alert
 * pipeline (manager-alert-service.ts).
 *
 * When the brain detects a genuine operational threat (alertNeeded = true,
 * severity = critical | high), this dispatcher:
 *   1. Resolves the alert type from the brain's primary threat modules
 *   2. Enforces a site-level 2-hour dedup — no manager at this site gets
 *      the same alert type more than once per 2 hours from the automated pipeline
 *   3. Fetches all active managers at the site whose alert_preferences opt them in
 *   4. Creates manager_alert rows and dispatches via WhatsApp for each
 *   5. Returns a structured result for cron observability
 *
 * Design decisions:
 *   - Source is always "system" — never "manual". This lets the UI and cron
 *     distinguish automated brain alerts from operator-created ones.
 *   - Dedup is site-level, not per-manager. If any manager at this site
 *     received this alert type (source=system) within DEDUP_WINDOW_MINUTES,
 *     the whole site is skipped. This prevents flooding when the cron fires
 *     every 30 minutes and the threat persists.
 *   - Quiet hours are enforced inside sendManagerAlert — we get this for free.
 *   - Medium/low threats are NOT dispatched. The brain surfaces these to the
 *     dashboard; WhatsApp is reserved for situations that require immediate action.
 *   - "All Systems Nominal" and "System Initialising" sentinel titles are
 *     never dispatched regardless of the alertNeeded flag.
 *
 * Never call this function from page load or UI request paths.
 * It is designed for cron / scheduler callers only.
 */

import { logger } from "@/lib/logger";
import { createServerClient } from "@/lib/supabase/server";
import {
  createManagerAlert,
  sendManagerAlert,
} from "@/services/alerts/manager-alert-service";
import type { BrainOutput, BrainThreatSeverity } from "@/services/brain/operating-brain";
import type { AlertType, AlertSeverity, AlertPreferences } from "@/types/manager-alerts";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Site-level dedup window. Any system brain alert of the same type sent
 *  within this window causes the site to be skipped entirely. */
const DEDUP_WINDOW_MINUTES = 120;

/** Only dispatch for these brain threat severities. */
const DISPATCH_THRESHOLD: BrainThreatSeverity[] = ["critical", "high"];

/** Brain titles that are sentinel "no threat" values — never dispatch. */
const SENTINEL_TITLES = new Set([
  "All Systems Nominal",
  "System Initialising",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrainDispatchResult {
  siteId: string;
  alertType: AlertType | null;
  dispatched: number;
  skipped: number;
  errors: number;
  outcome:
    | "no_alert_needed"
    | "severity_below_threshold"
    | "sentinel_title"
    | "site_deduped"
    | "no_eligible_managers"
    | "dispatched"
    | "all_failed";
}

// ── Module mapping ────────────────────────────────────────────────────────────

/**
 * Map brain module names → AlertType.
 *
 * The brain uses uppercase module names (e.g. "REVENUE", "LABOUR").
 * We take the first recognised module from the threat's modulesInvolved list.
 * Falls back to "custom" if no recognised module found.
 */
const MODULE_TO_ALERT_TYPE: Record<string, AlertType> = {
  REVENUE:     "revenue",
  LABOUR:      "labour",
  LABOR:       "labour",    // alternate spelling guard
  COMPLIANCE:  "compliance",
  MAINTENANCE: "maintenance",
  INVENTORY:   "inventory",
  INCIDENT:    "incident",
};

function resolveAlertType(modules: string[]): AlertType {
  for (const mod of modules) {
    const mapped = MODULE_TO_ALERT_TYPE[mod.toUpperCase()];
    if (mapped) return mapped;
  }
  return "custom";
}

// ── Severity mapping ──────────────────────────────────────────────────────────

function resolveAlertSeverity(brainSeverity: BrainThreatSeverity): AlertSeverity {
  switch (brainSeverity) {
    case "critical": return "critical";
    case "high":     return "critical";  // high brain threat → critical WhatsApp alert
    case "medium":   return "warning";
    case "low":      return "info";
  }
}

// ── Alert preference key ──────────────────────────────────────────────────────

/**
 * Map AlertType to the key in AlertPreferences.
 * Managers opt in/out per alert type — only send if their preference is true
 * (or not explicitly set, which we treat as opted-in by default).
 */
function preferenceKeyFor(type: AlertType): keyof AlertPreferences | null {
  const map: Partial<Record<AlertType, keyof AlertPreferences>> = {
    labour:      "labour",
    revenue:     "revenue",
    compliance:  "compliance",
    maintenance: "maintenance",
    incident:    "incident",
    inventory:   "inventory",
    sync:        "sync",
  };
  return map[type] ?? null;
}

function managerOptedIn(prefs: AlertPreferences | null, type: AlertType): boolean {
  if (!prefs) return true; // no prefs set → default opt-in
  const key = preferenceKeyFor(type);
  if (!key) return true;   // custom / unknown type → default opt-in
  // If the preference key is explicitly false, opt out. Undefined = opt in.
  return prefs[key] !== false;
}

// ── Site-level dedup ──────────────────────────────────────────────────────────

/**
 * Returns true if a system brain alert of this type was already sent for this
 * site within DEDUP_WINDOW_MINUTES. Suppresses the entire dispatch for the site.
 */
async function isSiteDeduped(siteId: string, alertType: AlertType): Promise<boolean> {
  const db = createServerClient();
  const dedupSince = new Date(
    Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1_000,
  ).toISOString();

  const { count, error } = await db
    .from("manager_alerts")
    .select("id", { count: "exact", head: true })
    .eq("site_id",   siteId)
    .eq("alert_type", alertType)
    .eq("source",    "system")
    .eq("status",    "sent")
    .gte("sent_at",  dedupSince);

  if (error) {
    // On dedup query error, allow dispatch (fail open) rather than silently
    // suppressing alerts that may be operationally critical.
    logger.warn("[BrainDispatcher] dedup query failed — allowing dispatch", {
      siteId, alertType, error: error.message,
    });
    return false;
  }

  return (count ?? 0) > 0;
}

// ── Manager resolution ────────────────────────────────────────────────────────

interface EligibleManager {
  id:             string;
  name:           string;
  phone_whatsapp: string;
}

/**
 * Fetch all active managers at a site who have opted in to this alert type.
 */
async function getEligibleManagers(
  siteId: string,
  alertType: AlertType,
): Promise<EligibleManager[]> {
  const db = createServerClient();

  const { data, error } = await db
    .from("manager_contacts")
    .select("id, name, phone_whatsapp, is_active, alert_preferences")
    .eq("site_id",   siteId)
    .eq("is_active", true);

  if (error || !data) {
    logger.error("[BrainDispatcher] failed to fetch manager contacts", {
      siteId, error: error?.message,
    });
    return [];
  }

  return (
    data as {
      id: string;
      name: string;
      phone_whatsapp: string;
      is_active: boolean;
      alert_preferences: AlertPreferences | null;
    }[]
  )
    .filter((m) => m.is_active && managerOptedIn(m.alert_preferences, alertType))
    .map((m) => ({ id: m.id, name: m.name, phone_whatsapp: m.phone_whatsapp }));
}

// ── Message builder ───────────────────────────────────────────────────────────

/**
 * Build a concise, actionable WhatsApp message from BrainOutput.
 * Kept under 300 chars — WhatsApp previews truncate at ~320.
 */
function buildAlertMessage(brain: BrainOutput): string {
  const threat = brain.primaryThreat;
  const lines: string[] = [];

  lines.push(threat.description);

  if (threat.moneyAtRisk > 0) {
    lines.push(`💰 Revenue at risk: R${threat.moneyAtRisk.toLocaleString("en-ZA")}`);
  }

  if (threat.recommendedAction) {
    lines.push(`👉 ${threat.recommendedAction}`);
  }

  if (threat.timeWindowLabel) {
    lines.push(`⏱ Time window: ${threat.timeWindowLabel}`);
  }

  return lines.join("\n");
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Evaluate a BrainOutput and dispatch WhatsApp alerts to eligible managers
 * if the threat meets the dispatch threshold.
 *
 * Safe to call from cron routes. Never call from page/API request paths.
 *
 * @param brain  - Output from runOperatingBrain()
 * @param siteId - Must match brain.siteId; passed explicitly for safety
 */
export async function dispatchBrainAlerts(
  brain: BrainOutput,
  siteId: string,
): Promise<BrainDispatchResult> {
  const base: Omit<BrainDispatchResult, "outcome" | "dispatched" | "skipped" | "errors"> = {
    siteId,
    alertType: null,
  };

  // ── Guard: no alert needed ────────────────────────────────────────────────
  const alertNeeded = brain.primaryThreat.severity === "critical" || brain.primaryThreat.severity === "high";
  if (!alertNeeded) {
    logger.info("[BrainDispatcher] alertNeeded=false — skipping", { siteId });
    return { ...base, alertType: null, dispatched: 0, skipped: 0, errors: 0, outcome: "no_alert_needed" };
  }

  // ── Guard: sentinel titles ────────────────────────────────────────────────
  if (SENTINEL_TITLES.has(brain.primaryThreat.title)) {
    logger.info("[BrainDispatcher] sentinel title — skipping", {
      siteId, title: brain.primaryThreat.title,
    });
    return { ...base, alertType: null, dispatched: 0, skipped: 0, errors: 0, outcome: "sentinel_title" };
  }

  // ── Guard: severity threshold ─────────────────────────────────────────────
  if (!DISPATCH_THRESHOLD.includes(brain.primaryThreat.severity)) {
    logger.info("[BrainDispatcher] severity below threshold", {
      siteId, severity: brain.primaryThreat.severity,
    });
    return { ...base, alertType: null, dispatched: 0, skipped: 0, errors: 0, outcome: "severity_below_threshold" };
  }

  const alertType     = resolveAlertType(brain.primaryThreat.modulesInvolved);
  const alertSeverity = resolveAlertSeverity(brain.primaryThreat.severity);

  logger.info("[BrainDispatcher] evaluating dispatch", {
    siteId,
    alertType,
    alertSeverity,
    threatTitle:  brain.primaryThreat.title,
    moneyAtRisk:  brain.primaryThreat.moneyAtRisk,
  });

  // ── Guard: site-level dedup ───────────────────────────────────────────────
  const deduped = await isSiteDeduped(siteId, alertType);
  if (deduped) {
    logger.info("[BrainDispatcher] site deduped — already alerted within window", {
      siteId, alertType, windowMinutes: DEDUP_WINDOW_MINUTES,
    });
    return { ...base, alertType, dispatched: 0, skipped: 1, errors: 0, outcome: "site_deduped" };
  }

  // ── Fetch eligible managers ───────────────────────────────────────────────
  const managers = await getEligibleManagers(siteId, alertType);

  if (managers.length === 0) {
    logger.info("[BrainDispatcher] no eligible managers", { siteId, alertType });
    return { ...base, alertType, dispatched: 0, skipped: 0, errors: 0, outcome: "no_eligible_managers" };
  }

  // ── Dispatch to each eligible manager ────────────────────────────────────
  const message = buildAlertMessage(brain);
  let dispatched = 0;
  let skipped    = 0;
  let errors     = 0;

  const dispatchResults = await Promise.allSettled(
    managers.map(async (manager) => {
      let alertRow;
      try {
        alertRow = await createManagerAlert({
          site_id:    siteId,
          manager_id: manager.id,
          alert_type: alertType,
          severity:   alertSeverity,
          source:     "system",
          title:      brain.primaryThreat.title,
          message,
        });
      } catch (err) {
        logger.error("[BrainDispatcher] createManagerAlert failed", {
          siteId, managerId: manager.id, alertType,
          error: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, reason: "create_failed" } as const;
      }

      const sendResult = await sendManagerAlert(alertRow.id);

      if (sendResult.skipped) {
        return { ok: false, reason: "send_skipped" } as const;
      }
      if (!sendResult.ok) {
        return { ok: false, reason: "send_failed" } as const;
      }

      logger.info("[BrainDispatcher] alert dispatched", {
        siteId,
        managerId:  manager.id,
        managerName: manager.name,
        alertId:    alertRow.id,
        alertType,
        severity:   alertSeverity,
      });

      return { ok: true } as const;
    }),
  );

  for (const result of dispatchResults) {
    if (result.status === "rejected") {
      errors++;
    } else if (!result.value.ok) {
      skipped++;
    } else {
      dispatched++;
    }
  }

  const outcome: BrainDispatchResult["outcome"] =
    dispatched > 0 ? "dispatched" : errors > 0 ? "all_failed" : "no_eligible_managers";

  logger.info("[BrainDispatcher] dispatch complete", {
    siteId, alertType, dispatched, skipped, errors, outcome,
  });

  return { siteId, alertType, dispatched, skipped, errors, outcome };
}
