/**
 * lib/incidents/sla.ts
 *
 * Pure, deterministic SLA calculation helpers for system incidents.
 *
 * No I/O. No side effects. Safe to import from both server and client contexts.
 * All time calculations accept an optional `now` epoch (ms) parameter so that
 * tests can pass a fixed timestamp for fully deterministic results.
 *
 * SLA thresholds (initial):
 *   critical  — acknowledge within 15 min,  resolve within  4 h
 *   warning   — acknowledge within 30 min,  resolve within  8 h
 *   info      — acknowledge within  2 h,    resolve within 24 h
 *
 * Escalation ladder:
 *   urgent   — age ≥ 90% of resolve threshold
 *   elevated — ack SLA breached, or age ≥ 50% of resolve threshold
 *   normal   — within all thresholds
 */

// ── SLA thresholds ─────────────────────────────────────────────────────────────

export interface SlaThreshold {
  /** Maximum minutes to first acknowledgement before breach. */
  ackMinutes: number;
  /** Maximum minutes to resolution before breach. */
  resolveMinutes: number;
}

export const SLA_THRESHOLDS: Record<"critical" | "warning" | "info", SlaThreshold> = {
  critical: { ackMinutes:   15, resolveMinutes:   240 }, //  4 h
  warning:  { ackMinutes:   30, resolveMinutes:   480 }, //  8 h
  info:     { ackMinutes:  120, resolveMinutes:  1440 }, // 24 h
};

// ── Input type ────────────────────────────────────────────────────────────────

/**
 * Minimal incident shape consumed by SLA functions.
 * Matches the subset of SystemIncident needed for SLA reasoning.
 */
export interface IncidentForSla {
  severity:        "info" | "warning" | "critical";
  /** "open" | "acknowledged" | "investigating" | "resolved" */
  status:          string;
  createdAt:       string;
  resolvedAt:      string | null | undefined;
  acknowledgedAt:  string | null | undefined;
  escalationLevel?: "normal" | "elevated" | "urgent" | null;
}

// ── Output type ───────────────────────────────────────────────────────────────

export type SlaStatus =
  | "within_sla"
  | "ack_breached"
  | "resolution_breached"
  | "resolved";

export interface IncidentSlaState {
  /** Age of incident in fractional minutes from createdAt to now. */
  ageMinutes: number;
  /** Minutes from createdAt to acknowledgedAt. Null if not yet acknowledged. */
  timeToAckMinutes: number | null;
  /** Minutes from createdAt to resolvedAt (MTTR). Null if not yet resolved. */
  mttrMinutes: number | null;
  /** Ack SLA threshold exceeded and incident is still unacknowledged. */
  ackBreached: boolean;
  /** Resolve SLA threshold exceeded and incident is still unresolved. */
  resolutionBreached: boolean;
  /** Computed escalation recommendation based on age vs SLA thresholds. */
  recommendedEscalation: "normal" | "elevated" | "urgent";
  /** Overall SLA health classification. */
  slaStatus: SlaStatus;
}

// ── Individual helpers ────────────────────────────────────────────────────────

/**
 * Incident age in fractional minutes from createdAt to `now`.
 */
export function calculateIncidentAge(
  incident: Pick<IncidentForSla, "createdAt">,
  now: number = Date.now(),
): number {
  return (now - new Date(incident.createdAt).getTime()) / 60_000;
}

/**
 * Time-to-acknowledge in fractional minutes.
 * Returns null if the incident has not been acknowledged.
 */
export function calculateTimeToAcknowledge(
  incident: Pick<IncidentForSla, "createdAt" | "acknowledgedAt">,
): number | null {
  if (!incident.acknowledgedAt) return null;
  return (
    new Date(incident.acknowledgedAt).getTime() -
    new Date(incident.createdAt).getTime()
  ) / 60_000;
}

/**
 * Mean time to resolve in fractional minutes.
 * Returns null if the incident has not been resolved.
 */
export function calculateTimeToResolve(
  incident: Pick<IncidentForSla, "createdAt" | "resolvedAt">,
): number | null {
  if (!incident.resolvedAt) return null;
  return (
    new Date(incident.resolvedAt).getTime() -
    new Date(incident.createdAt).getTime()
  ) / 60_000;
}

/**
 * Whether the acknowledgement SLA is breached.
 *
 * Breached = ack threshold exceeded AND incident not yet acknowledged.
 * Resolved incidents are never considered ack-breached.
 */
export function isAckBreached(
  incident: Pick<IncidentForSla, "severity" | "status" | "createdAt" | "acknowledgedAt">,
  now: number = Date.now(),
): boolean {
  if (incident.status === "resolved") return false;
  if (incident.acknowledgedAt)        return false;
  const threshold = SLA_THRESHOLDS[incident.severity] ?? SLA_THRESHOLDS.info;
  return calculateIncidentAge({ createdAt: incident.createdAt }, now) >= threshold.ackMinutes;
}

/**
 * Whether the resolution SLA is breached.
 *
 * Breached = resolve threshold exceeded AND incident not yet resolved.
 *
 * The resolution clock starts from `acknowledgedAt` when set (the moment an
 * operator took ownership), otherwise from `createdAt`. This matches the
 * intent of the SLA: the 4-hour / 8-hour window is an *operator response*
 * window, not an absolute wall-clock from creation.
 *
 * Boundary: exactly AT the threshold is NOT breached (strict >).
 */
export function isResolutionBreached(
  incident: Pick<IncidentForSla, "severity" | "status" | "createdAt" | "resolvedAt" | "acknowledgedAt">,
  now: number = Date.now(),
): boolean {
  if (incident.status === "resolved") return false;
  const threshold = SLA_THRESHOLDS[incident.severity] ?? SLA_THRESHOLDS.info;
  // Resolution clock starts from acknowledgement (if set) so operators are
  // not penalised for time that elapsed before they could even ack.
  const startMs = incident.acknowledgedAt
    ? new Date(incident.acknowledgedAt).getTime()
    : new Date(incident.createdAt).getTime();
  const elapsedMin = (now - startMs) / 60_000;
  return elapsedMin > threshold.resolveMinutes;
}

/**
 * Derive a recommended escalation level based on SLA health.
 *
 *   urgent   — age ≥ 90% of resolve threshold (critical path)
 *   elevated — ack SLA breached, or age ≥ 50% of resolve threshold
 *   normal   — within all thresholds
 *
 * Resolved incidents always return "normal".
 */
export function getEscalationRecommendation(
  incident: IncidentForSla,
  now: number = Date.now(),
): "normal" | "elevated" | "urgent" {
  if (incident.status === "resolved") return "normal";

  const threshold = SLA_THRESHOLDS[incident.severity] ?? SLA_THRESHOLDS.info;
  const age       = calculateIncidentAge({ createdAt: incident.createdAt }, now);

  if (age >= threshold.resolveMinutes * 0.9) return "urgent";
  if (isAckBreached(incident, now) || age >= threshold.resolveMinutes * 0.5) return "elevated";
  return "normal";
}

/**
 * Compute the full SLA state for an incident.
 *
 * @param incident  Incident data (IncidentForSla shape).
 * @param now       Optional epoch ms override — use in tests for determinism.
 */
export function getIncidentSlaState(
  incident: IncidentForSla,
  now: number = Date.now(),
): IncidentSlaState {
  const ageMinutes           = calculateIncidentAge(incident, now);
  const timeToAckMinutes     = calculateTimeToAcknowledge(incident);
  const mttrMinutes          = calculateTimeToResolve(incident);
  const ackBreached          = isAckBreached(incident, now);
  const resolutionBreached   = isResolutionBreached(incident, now);
  const recommendedEscalation = getEscalationRecommendation(incident, now);

  let slaStatus: SlaStatus;
  if (incident.status === "resolved")   slaStatus = "resolved";
  else if (resolutionBreached)           slaStatus = "resolution_breached";
  else if (ackBreached)                  slaStatus = "ack_breached";
  else                                   slaStatus = "within_sla";

  return {
    ageMinutes,
    timeToAckMinutes,
    mttrMinutes,
    ackBreached,
    resolutionBreached,
    recommendedEscalation,
    slaStatus,
  };
}
