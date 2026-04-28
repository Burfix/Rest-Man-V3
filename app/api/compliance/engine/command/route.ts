/**
 * GET /api/compliance/engine/command
 *
 * Full executive compliance snapshot for the Head Office Command Center.
 * Runs all sub-queries in parallel — single call for the entire dashboard.
 *
 * Returns:
 *   headline, compliance_pct, non_compliant_count, expiring_soon_count,
 *   awaiting_review_count, audit_readiness_pct, top_risks (all, sorted by
 *   severity), tenant_summaries (all tenants), expiring_soon (all windows
 *   including expired), generated_at
 *
 * Auth: requires a valid session (any role).
 */
import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import {
  getTenantSummaries,
  getRiskFlags,
  getExpiringSoon,
} from "@/lib/compliance/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(null, "GET /api/compliance/engine/command");
  if (guard.error) return guard.error;

  try {
    // All three in parallel — service role, no RLS overhead
    const [summaries, allRisks, expiringAll] = await Promise.all([
      getTenantSummaries(),
      getRiskFlags(),       // all levels, all tenants
      getExpiringSoon(),    // full view: EXPIRED + 30/60/90 days
    ]);

    // ── Aggregate KPIs ─────────────────────────────────────────────────────────
    const totalTenants = summaries.length;

    const criticalCount = allRisks.filter((r) => r.risk_level === "CRITICAL").length;
    const warningCount  = allRisks.filter((r) => r.risk_level === "WARNING").length;

    // Non-compliant = distinct tenants with at least one CRITICAL flag
    const nonCompliantCount = new Set(
      allRisks.filter((r) => r.risk_level === "CRITICAL").map((r) => r.tenant_id),
    ).size;

    // Expiring soon = certs within 90 days that are not yet expired
    const expiringSoonCount = expiringAll.filter(
      (e) => e.expiry_window !== "EXPIRED" && e.expiry_window !== "OK",
    ).length;

    const awaitingReviewCount = summaries.reduce((n, s) => n + s.awaiting_review, 0);

    // Audit readiness = % of total certs that are APPROVED
    const totalCerts    = summaries.reduce((n, s) => n + s.total_certificates, 0);
    const totalApproved = summaries.reduce((n, s) => n + s.approved, 0);
    const auditReadinessPct =
      totalCerts === 0 ? null : Math.round((totalApproved / totalCerts) * 100);

    // Precinct health = average compliance % across all tenants
    const compliancePct =
      totalTenants === 0
        ? null
        : Math.round(
            summaries.reduce((sum, s) => sum + (s.compliance_pct ?? 0), 0) / totalTenants,
          );

    // ── Headline ───────────────────────────────────────────────────────────────
    let headline: string;
    if (nonCompliantCount > 0) {
      headline = `${nonCompliantCount} tenant${nonCompliantCount === 1 ? "" : "s"} non-compliant this week`;
    } else if (expiringSoonCount > 0) {
      const cert30 = expiringAll.filter((e) => e.expiry_window === "30_DAYS").length;
      if (cert30 > 0) {
        headline = `${cert30} certificate${cert30 === 1 ? "" : "s"} expire within 30 days`;
      } else {
        headline = `${expiringSoonCount} certificate${expiringSoonCount === 1 ? "" : "s"} expire within 90 days`;
      }
    } else {
      headline = "Precinct compliance operating within target";
    }

    // ── Sort risks: CRITICAL → WARNING → INFO, cap at 50 ─────────────────────
    const riskOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    const sortedRisks = [...allRisks]
      .sort((a, b) => riskOrder[a.risk_level] - riskOrder[b.risk_level])
      .slice(0, 50);

    return NextResponse.json({
      headline,
      compliance_pct:        compliancePct,
      total_tenants:         totalTenants,
      non_compliant_count:   nonCompliantCount,
      expiring_soon_count:   expiringSoonCount,
      awaiting_review_count: awaitingReviewCount,
      audit_readiness_pct:   auditReadinessPct,
      critical_count:        criticalCount,
      warning_count:         warningCount,
      top_risks:             sortedRisks,
      tenant_summaries:      summaries,
      expiring_soon:         expiringAll,
      generated_at:          new Date().toISOString(),
    });
  } catch (err) {
    logger.error("compliance engine: command aggregation failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load compliance command data" }, { status: 500 });
  }
}
