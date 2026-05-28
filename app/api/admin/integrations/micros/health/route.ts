/**
 * GET /api/admin/integrations/micros/health
 *
 * Non-secret integration health check for all registered MICROS locations.
 * Returns configuration status, missing env var names, auth flow, and
 * token isolation posture for each location in the registry.
 *
 * SECURITY CONTRACT:
 *   - Requires VIEW_ALL_STORES (head-office / super_admin) permission.
 *   - NEVER returns credential values, tokens, or client secrets.
 *   - Returns only: env var NAMES (not values), booleans, metadata strings.
 *   - Callers use this to determine what needs to be configured — not to
 *     read credentials.
 *
 * Response shape:
 *   {
 *     checkedAt: ISO timestamp,
 *     locationRefConflicts: [...],  // empty = OK
 *     locations: [
 *       {
 *         locationKey, displayName, enabled, configured,
 *         authFlow, envPrefix, locationRef,
 *         tokenIsolation: "per-location",
 *         missingEnv: ["MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET"],
 *         hasClientSecret, hasUsername, hasPassword,
 *       },
 *       ...
 *     ],
 *     summary: { total, configured, missingCredentials, disabled }
 *   }
 */

import { NextResponse }                     from "next/server";
import { apiGuard }                         from "@/lib/auth/api-guard";
import { PERMISSIONS }                      from "@/lib/rbac/roles";
import {
  getAllLocationConfigs,
  validateLocationRefUniqueness,
  getMissingEnvNames,
} from "@/lib/micros/micros-location-registry";
import { logger } from "@/lib/logger";

export const dynamic  = "force-dynamic";
export const revalidate = 0;
export const runtime  = "nodejs";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/integrations/micros/health");
  if (guard.error) return guard.error;

  try {
    const [configs, refConflicts] = await Promise.all([
      getAllLocationConfigs(),
      validateLocationRefUniqueness(),
    ]);

    const locations = configs.map((cfg) => {
      const missing = getMissingEnvNames(cfg);
      return {
        locationKey:     cfg.key,
        displayName:     cfg.displayName,
        enabled:         cfg.enabled,
        configured:      cfg.configured,
        authFlow:        cfg.authFlow,
        envPrefix:       cfg.envPrefix,
        locationRef:     cfg.locationRef ?? null,
        tokenIsolation:  "per-location" as const,
        missingEnv:      missing,
        // Presence flags — boolean only, no values
        hasClientSecret: cfg.clientSecret !== null && cfg.clientSecret.length > 0,
        hasUsername:     cfg.username !== null && cfg.username.length > 0,
        hasPassword:     cfg.password !== null && cfg.password.length > 0,
      };
    });

    const summary = {
      total:              locations.length,
      configured:         locations.filter((l) => l.configured && l.enabled).length,
      missingCredentials: locations.filter((l) => l.enabled && !l.configured).length,
      disabled:           locations.filter((l) => !l.enabled).length,
    };

    logger.info("[MICROS health] Integration health check", {
      summary,
      hasConflicts: refConflicts.length > 0,
    });

    return NextResponse.json({
      checkedAt:            new Date().toISOString(),
      locationRefConflicts: refConflicts,
      locations,
      summary,
    });
  } catch (err) {
    logger.error("[MICROS health] Failed to load integration health", { err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load MICROS integration health." },
      { status: 500 },
    );
  }
}
