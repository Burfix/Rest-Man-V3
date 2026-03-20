/**
 * lib/compliance/scoring.ts
 *
 * Pure compliance scoring helpers — shared across the ops engine and dashboard.
 *
 * These functions derive live compliance status and risk weighting from a
 * compliance item's date fields.  They are side-effect-free and can run on
 * both server and client.
 *
 * ── Status resolution order ───────────────────────────────────────────────
 *   expired     — next_due_date < today (regardless of any booking)
 *   scheduled   — within DUE_SOON_DAYS AND service is booked before expiry
 *   due_soon    — within DUE_SOON_DAYS, no pre-expiry service scheduled
 *   compliant   — next_due_date > today + DUE_SOON_DAYS
 *   unknown     — no next_due_date configured
 *
 * ── Key business rule ─────────────────────────────────────────────────────
 *   A certificate that is still valid AND has a service/renewal booked before
 *   expiry is treated as proactively managed — NOT as an active compliance
 *   failure.  It receives near-zero risk weight and does not drag down the
 *   compliance score.
 */

import type { ComplianceStatus } from "@/types";
import { todayISO } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Days ahead of expiry that triggers the "due soon" check. */
export const COMPLIANCE_DUE_SOON_DAYS = 30;

/**
 * Risk penalty weights per status (0 = no risk, 1 = full risk).
 *
 * - compliant:    no penalty
 * - scheduled:    near-zero penalty (proactively managed, certificate still valid)
 * - due_soon:     moderate penalty (expiry approaching, no confirmed booking)
 * - in_progress:  very low penalty (active renewal underway)
 * - expired:      full penalty — actual compliance breach
 * - blocked:      high penalty — known external blocker
 * - unknown:      zero (excluded from scoring — no data to assess)
 */
export const COMPLIANCE_RISK_WEIGHTS: Record<ComplianceStatus, number> = {
  compliant:   0.00,
  scheduled:   0.02,   // 2% — proactively managed
  due_soon:    0.45,   // 45% — unscheduled, approaching expiry
  in_progress: 0.05,   // 5% — work actively underway
  expired:     1.00,   // 100% — active breach
  blocked:     0.80,   // 80% — known blocker preventing completion
  unknown:     0.00,   // excluded from denominator
};

// ── Status derivation ─────────────────────────────────────────────────────────

/**
 * Derives the live compliance status for a single item.
 *
 * @param nextDueDate           ISO date (YYYY-MM-DD) of certificate expiry,
 *                              or null if no due date is configured.
 * @param scheduledServiceDate  ISO date of the booked renewal/service visit,
 *                              or null/undefined if no booking exists.
 */
export function computeComplianceStatus(
  nextDueDate:           string | null,
  scheduledServiceDate?: string | null,
): ComplianceStatus {
  if (!nextDueDate) return "unknown";

  const today = todayISO();

  // Expired: past the due date regardless of any future booking
  if (nextDueDate < today) return "expired";

  // Within the due-soon window — check if proactively managed
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + COMPLIANCE_DUE_SOON_DAYS);
  const thresholdISO = threshold.toISOString().slice(0, 10);

  if (nextDueDate <= thresholdISO) {
    // Proactive: a service is booked AND the booking is on or before the expiry date
    if (scheduledServiceDate && scheduledServiceDate <= nextDueDate) {
      return "scheduled";
    }
    return "due_soon";
  }

  return "compliant";
}

// ── Risk weight ───────────────────────────────────────────────────────────────

/**
 * Returns the risk penalty weight for a compliance status (0–1).
 * Scheduled items return near-zero weight — treated as controlled risk.
 */
export function getComplianceRiskWeight(status: ComplianceStatus): number {
  return COMPLIANCE_RISK_WEIGHTS[status] ?? 0;
}

// ── Score aggregation ─────────────────────────────────────────────────────────

/**
 * Calculates an aggregate compliance score (0–100) from an array of items.
 *
 * Items with status "unknown" are excluded from the denominator.
 * Items with status "scheduled" are treated as effectively compliant.
 *
 * @returns 0–100 where 100 = all items compliant or proactively scheduled
 */
export function calculateComplianceScore(
  items: Array<{ status: ComplianceStatus }>,
): number {
  const rated = items.filter((i) => i.status !== "unknown");
  if (rated.length === 0) return 0;

  const managed = rated.filter(
    (i) => i.status === "compliant" || i.status === "scheduled",
  ).length;

  return Math.round((managed / rated.length) * 100);
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** True when the certificate has not yet expired (next_due_date >= today). */
export function isValidNow(nextDueDate: string | null): boolean {
  if (!nextDueDate) return false;
  return nextDueDate >= todayISO();
}

/**
 * True when a service is booked on or before the certificate expiry date
 * (i.e. the renewal will happen while the certificate is still valid).
 */
export function isScheduledBeforeExpiry(
  nextDueDate:          string | null,
  scheduledServiceDate: string | null | undefined,
): boolean {
  if (!nextDueDate || !scheduledServiceDate) return false;
  return scheduledServiceDate <= nextDueDate;
}

/** Days until expiry. Negative values mean already expired. */
export function daysToExpiry(nextDueDate: string | null): number | null {
  if (!nextDueDate) return null;
  const today = new Date(todayISO());
  const due   = new Date(nextDueDate);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Days until a scheduled service visit. Negative = service date passed. */
export function daysToService(scheduledServiceDate: string | null | undefined): number | null {
  if (!scheduledServiceDate) return null;
  const today   = new Date(todayISO());
  const service = new Date(scheduledServiceDate);
  return Math.round((service.getTime() - today.getTime()) / 86_400_000);
}
