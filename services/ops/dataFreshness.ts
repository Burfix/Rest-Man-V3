/**
 * Data freshness service.
 * Returns how recently each operational data area was last updated,
 * so the dashboard can surface stale-data warnings without duplicating
 * the alert engine's threshold logic.
 */

import { createServerClient } from "@/lib/supabase/server";

export interface FreshnessItem {
  label: string;
  lastUpdatedAt: string | null;   // ISO string
  daysAgo: number | null;         // null = never
  stale: boolean;                 // true if over the threshold
  href: string;
  actionLabel: string;            // CTA when missing/stale
}

export interface DataFreshnessSummary {
  sales: FreshnessItem;
  reviews: FreshnessItem;
  maintenance: FreshnessItem;
  stock: FreshnessItem;
  compliance: FreshnessItem;
  /** MICROS BI sync — null = not configured (shown as neutral, never stale) */
  micros: FreshnessItem & { configured: boolean };
}

function daysAgo(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / 86_400_000);
}

export async function getDataFreshnessSummary(): Promise<DataFreshnessSummary> {
  const supabase = createServerClient();

  const [salesRes, reviewsRes, maintRes, stockRes, complianceRes, microsRes] = await Promise.all([
    supabase
      .from("sales_uploads")
      .select("uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("reviews")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("maintenance_logs")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("stock_movements")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("compliance_items")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("micros_connections")
      .select("last_successful_sync_at, status, auth_server_url")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const salesDate = (salesRes.data as { uploaded_at: string } | null)?.uploaded_at ?? null;
  const reviewDate = (reviewsRes.data as { created_at: string } | null)?.created_at ?? null;
  const maintDate = (maintRes.data as { updated_at: string } | null)?.updated_at ?? null;
  const stockDate = (stockRes.data as { created_at: string } | null)?.created_at ?? null;
  const complianceDate = (complianceRes.data as { updated_at: string } | null)?.updated_at ?? null;
  const microsRow = microsRes.data as { last_successful_sync_at: string | null; status: string; auth_server_url: string } | null;
  const microsDate = microsRow?.last_successful_sync_at ?? null;
  const microsConfigured = !!(microsRow?.auth_server_url);

  return {
    sales: {
      label: "Sales data",
      lastUpdatedAt: salesDate,
      daysAgo: daysAgo(salesDate),
      stale: salesDate === null || (daysAgo(salesDate) ?? 999) > 8,
      href: "/dashboard/sales",
      actionLabel: "Upload weekly sales",
    },
    reviews: {
      label: "Reviews",
      lastUpdatedAt: reviewDate,
      daysAgo: daysAgo(reviewDate),
      stale: reviewDate === null || (daysAgo(reviewDate) ?? 999) > 14,
      href: "/dashboard/reviews",
      actionLabel: "Sync or import reviews",
    },
    maintenance: {
      label: "Maintenance",
      lastUpdatedAt: maintDate,
      daysAgo: daysAgo(maintDate),
      stale: maintDate === null || (daysAgo(maintDate) ?? 999) > 30,
      href: "/dashboard/maintenance",
      actionLabel: "Log equipment or repair",
    },
    stock: {
      label: "Stock",
      lastUpdatedAt: stockDate,
      daysAgo: daysAgo(stockDate),
      stale: stockDate === null || (daysAgo(stockDate) ?? 999) > 7,
      href: "/dashboard/inventory",
      actionLabel: "Record stock movement",
    },
    compliance: {
      label: "Compliance",
      lastUpdatedAt: complianceDate,
      daysAgo: daysAgo(complianceDate),
      stale: complianceDate === null || (daysAgo(complianceDate) ?? 999) > 30,
      href: "/dashboard/settings/compliance",
      actionLabel: "Review compliance items",
    },
    micros: {
      label: "MICROS",
      lastUpdatedAt: microsDate,
      daysAgo: minutesAgo(microsDate),
      // Only flag stale when configured AND last sync > 6 hours ago
      stale: microsConfigured && (microsDate === null || (minutesAgo(microsDate) ?? 999) > 360),
      href: "/dashboard/settings/integrations",
      actionLabel: microsConfigured ? "MICROS sync overdue" : "Set up MICROS integration",
      configured: microsConfigured,
    },
  };
}

/**
 * Returns minutes since the given ISO date (null = never synced).
 * Reused for MICROS which syncs in minutes not days.
 */
function minutesAgo(isoDate: string | null): number | null {
  if (!isoDate) return null;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000);
}
