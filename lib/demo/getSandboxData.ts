/**
 * Sandbox mirror — injects Si Cantina's live metrics into a sandbox site card.
 *
 * This keeps demo environments populated with realistic live data without
 * touching any production tables.
 */

import type { SiteCardData } from "@/app/api/head-office/sites/route";
import { isSandboxSite }     from "./isSandboxSite";

/**
 * If `site` is a sandbox, replace its metrics with `siCantinaMetrics`
 * and flag it as demo data.  Otherwise returns `site` unchanged.
 */
export function applySandboxMirror(
  site:              SiteCardData,
  siCantinaMetrics:  SiteCardData | null,
): SiteCardData {
  if (!isSandboxSite({ storeCode: site.storeCode, siteName: site.siteName })) {
    return site;
  }

  if (!siCantinaMetrics) {
    // No Si Cantina data available — return sandbox as-is but flagged
    return {
      ...site,
      isDemoData:    true,
      mirroredFrom:  "Si Cantina Sociale",
    };
  }

  return {
    ...site,
    // Override all metrics with Si Cantina live data
    revenueTodayNet:  siCantinaMetrics.revenueTodayNet,
    guestCount:       siCantinaMetrics.guestCount,
    revenueChecks:    siCantinaMetrics.revenueChecks,
    revenueDate:      siCantinaMetrics.revenueDate,
    labourHours:      siCantinaMetrics.labourHours,
    labourTimecards:  siCantinaMetrics.labourTimecards,
    labourDate:       siCantinaMetrics.labourDate,
    microsStatus:     siCantinaMetrics.microsStatus,
    microsDataAgeMin: siCantinaMetrics.microsDataAgeMin,
    complianceScore:  siCantinaMetrics.complianceScore,
    complianceDueSoon: siCantinaMetrics.complianceDueSoon,
    complianceOverdue: siCantinaMetrics.complianceOverdue,
    healthGrade:      siCantinaMetrics.healthGrade,
    healthScore:      siCantinaMetrics.healthScore,
    staleMins:        siCantinaMetrics.staleMins,
    lastSyncAt:       siCantinaMetrics.lastSyncAt,
    // Sandbox identity
    isDemoData:    true,
    mirroredFrom:  "Si Cantina Sociale",
  };
}
