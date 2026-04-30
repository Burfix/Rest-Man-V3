/**
 * siteOperationalStatus
 *
 * Pure function: derives a site's operational status from its deployment_stage
 * and available data signals. Returns a structured object with plain-English
 * blockers and next-action guidance for Head Office executives.
 *
 * Intentionally free of technical jargon — "POS connection" not "MICROS integration".
 */

export type ModuleDataState = "live" | "estimated" | "none";
export type SiteStatus      = "live" | "partial" | "pending";

export interface SiteModuleStatus {
  revenue:     ModuleDataState;
  labour:      ModuleDataState;
  compliance:  "live" | "none";
  maintenance: "live" | "none";
}

export interface SiteOperationalStatus {
  /** Overall readiness of the site */
  status:      SiteStatus;
  /** Per-module data availability */
  modules:     SiteModuleStatus;
  /** Plain-English list of what is blocking full live status */
  blockers:    string[];
  /** Single recommended action for the executive to take (or share) */
  next_action: string;
}

export interface SiteStatusInput {
  deployment_stage:   "live" | "partial" | "pending";
  /** True if the site has an active POS connection (revenue + labour data flows in) */
  has_pos_connection: boolean;
  /** True if the site has uploaded manual daily sales data recently */
  has_manual_sales:   boolean;
  /** True if compliance items exist for this site */
  has_compliance:     boolean;
  /** True if maintenance items exist for this site */
  has_maintenance:    boolean;
}

export function getSiteOperationalStatus(
  input: SiteStatusInput,
): SiteOperationalStatus {
  const {
    deployment_stage,
    has_pos_connection,
    has_manual_sales,
    has_compliance,
    has_maintenance,
  } = input;

  // ── Module states ──────────────────────────────────────────────────────────
  const revenue: ModuleDataState =
    has_pos_connection ? "live"
    : has_manual_sales ? "estimated"
    : "none";

  // Labour only flows from POS; no manual fallback.
  const labour: ModuleDataState = has_pos_connection ? "live" : "none";

  // Compliance / maintenance tracked independently of POS.
  const compliance:  "live" | "none" = has_compliance  ? "live" : "none";
  const maintenance: "live" | "none" = has_maintenance ? "live" : "none";

  const modules: SiteModuleStatus = { revenue, labour, compliance, maintenance };

  // ── Blockers (plain English) ───────────────────────────────────────────────
  const blockers: string[] = [];

  if (deployment_stage === "pending") {
    blockers.push("Store setup not yet complete");
  } else {
    if (!has_pos_connection) {
      blockers.push("Waiting for POS connection — revenue and labour not tracked");
    } else if (revenue === "estimated") {
      blockers.push("Revenue data is estimated — live POS feed not confirmed");
    }
    if (compliance === "none") {
      blockers.push("Compliance checklist not yet configured");
    }
    if (maintenance === "none") {
      blockers.push("Maintenance tracker not yet configured");
    }
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  let status: SiteStatus;

  if (deployment_stage === "pending") {
    status = "pending";
  } else if (
    revenue    === "live" &&
    labour     === "live" &&
    compliance === "live" &&
    maintenance === "live"
  ) {
    status = "live";
  } else {
    status = "partial";
  }

  // ── Next action (executive guidance) ──────────────────────────────────────
  let next_action: string;

  if (status === "pending") {
    next_action = "Complete store setup before go-live";
  } else if (!has_pos_connection) {
    next_action = "Connect POS system to enable revenue and labour tracking";
  } else if (revenue === "estimated") {
    next_action = "Confirm POS connection to move from estimated to live data";
  } else if (compliance === "none" || maintenance === "none") {
    next_action = "Finish configuring compliance and maintenance modules";
  } else {
    next_action = "All modules live — no action required";
  }

  return { status, modules, blockers, next_action };
}

// ── Derived helpers for display ────────────────────────────────────────────────

export const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  live:    "Live",
  partial: "Partial",
  pending: "Not Connected",
};

export const MODULE_LABEL: Record<keyof SiteModuleStatus, string> = {
  revenue:     "Revenue",
  labour:      "Labour",
  compliance:  "Compliance",
  maintenance: "Maintenance",
};
