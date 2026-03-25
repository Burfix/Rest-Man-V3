/**
 * Site Configuration — single source of truth for per-site operational targets.
 *
 * Replaces all hardcoded constants (TARGET_LABOUR_PCT, TARGET_AVG_SPEND,
 * SEATING_CAPACITY, etc.) with database-backed values per site.
 *
 * Usage:
 *   const cfg = await getSiteConfig(siteId);
 *   // cfg.target_labour_pct, cfg.target_avg_spend, cfg.seating_capacity
 */

import { createServerClient } from "@/lib/supabase/server";

export interface SiteConfig {
  site_id: string;
  site_name: string;
  target_labour_pct: number;
  target_avg_spend: number;
  target_margin_pct: number;
  seating_capacity: number;
  currency_symbol: string;
  timezone: string;
}

const DEFAULTS: Omit<SiteConfig, "site_id" | "site_name"> = {
  target_labour_pct: 30,
  target_avg_spend: 280,
  target_margin_pct: 12,
  seating_capacity: 200,
  currency_symbol: "R",
  timezone: "Africa/Johannesburg",
};

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";

// In-memory cache (per process lifetime, ~5 min TTL)
let _cache: { config: SiteConfig; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSiteConfig(
  siteId: string = DEFAULT_SITE_ID,
): Promise<SiteConfig> {
  // Check cache
  if (_cache && _cache.config.site_id === siteId && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.config;
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, target_labour_pct, target_avg_spend, target_margin_pct, seating_capacity, currency_symbol, timezone")
    .eq("id", siteId)
    .maybeSingle();

  const row = data as Record<string, unknown> | null;
  const config: SiteConfig = {
    site_id: siteId,
    site_name: (row?.name as string) ?? "Unknown",
    target_labour_pct: Number(row?.target_labour_pct) || DEFAULTS.target_labour_pct,
    target_avg_spend: Number(row?.target_avg_spend) || DEFAULTS.target_avg_spend,
    target_margin_pct: Number(row?.target_margin_pct) || DEFAULTS.target_margin_pct,
    seating_capacity: Number(row?.seating_capacity) || DEFAULTS.seating_capacity,
    currency_symbol: (row?.currency_symbol as string) ?? DEFAULTS.currency_symbol,
    timezone: (row?.timezone as string) ?? DEFAULTS.timezone,
  };

  _cache = { config, ts: Date.now() };
  return config;
}

/** Clear config cache (e.g., after settings update) */
export function clearSiteConfigCache(): void {
  _cache = null;
}
