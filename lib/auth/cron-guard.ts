/**
 * Cron route guard — verifies the Authorization: Bearer CRON_SECRET header.
 *
 * Usage:
 *   const denied = cronGuard(req, "GET /api/micros/sync");
 *   if (denied) return denied;
 *
 * Returns a NextResponse (401 or 500) when the request is NOT authorised,
 * or null when it IS authorised (caller should continue normally).
 *
 * CRON_SECRET MUST be configured — returns HTTP 500 if missing so
 * misconfigured deployments fail loudly rather than silently allowing access.
 *
 * Vercel cron jobs automatically attach the Authorization header when
 * CRON_SECRET is set in the project environment variables.
 */

import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Authenticate a cron/internal request via CRON_SECRET.
 *
 * @param req   - The incoming NextRequest
 * @param route - Route label for log context (e.g. "GET /api/micros/sync")
 * @returns NextResponse if auth fails, null if auth passes
 */
export function cronGuard(req: NextRequest, route: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    logger.error("CRON_SECRET is not configured — cron route blocked", { route });
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET env var is not set" },
      { status: 500 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    logger.warn("Cron auth failed — invalid or missing Authorization header", { route });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // authorised — caller continues
}
