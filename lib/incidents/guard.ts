/**
 * lib/incidents/guard.ts
 *
 * Shared authorization guard for incident write endpoints.
 *
 * Encapsulates the four-step pattern common to all mutation routes:
 *   1. Authenticate the caller (getUserContext)
 *   2. Validate the incident UUID format
 *   3. Fetch the incident via service-role (RLS-free read)
 *   4. Check visibility: incident.site_id must be in the caller's siteIds
 *   5. Check write permission: caller's role must be in ALL_WRITE_ROLES
 *
 * Returns IncidentWriteGuard on success, NextResponse error on any failure.
 * Route handlers check: if (guard instanceof NextResponse) return guard;
 *
 * RLS note: application-layer checks here are defense-in-depth.
 * Migration 091 adds UPDATE RLS policies that enforce the same rules at DB level.
 */

import { NextResponse }                              from "next/server";
import { createClient }                              from "@supabase/supabase-js";
import { getUserContext, authErrorResponse }         from "@/lib/auth/get-user-context";
import type { UserContext }                          from "@/lib/auth/get-user-context";

// ── Role sets ─────────────────────────────────────────────────────────────────

/** Cross-site write access — can mutate any incident they can see. */
export const HQ_WRITE_ROLES = new Set([
  "super_admin", "executive", "head_office",
]);

/** Own-site write access — can mutate incidents at their accessible sites. */
export const SITE_WRITE_ROLES = new Set([
  "area_manager", "gm", "supervisor",
]);

/** Union of all roles permitted to mutate incidents. */
export const ALL_WRITE_ROLES = new Set([...HQ_WRITE_ROLES, ...SITE_WRITE_ROLES]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncidentRow {
  id:      string;
  site_id: string | null;
  status:  string;
}

export interface IncidentWriteGuard {
  ctx:      UserContext;
  incident: IncidentRow;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db:       any;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ── Public guard ──────────────────────────────────────────────────────────────

/**
 * Authorize an incident write operation.
 *
 * Usage in route handlers:
 *   const guard = await guardIncidentWrite(params.id);
 *   if (guard instanceof NextResponse) return guard;
 *   const { ctx, incident, db } = guard;
 */
export async function guardIncidentWrite(
  incidentId: string,
): Promise<IncidentWriteGuard | NextResponse> {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  let ctx: UserContext;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  // ── 2. Validate UUID format ────────────────────────────────────────────────
  if (!UUID_RE.test(incidentId)) {
    return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
  }

  // ── 3. Fetch incident (service-role, bypasses RLS) ─────────────────────────
  const db = serviceDb();
  const { data: incident } = await db
    .from("system_incidents")
    .select("id, site_id, status")
    .eq("id", incidentId)
    .maybeSingle();

  // ── 4. Not found → 404 ────────────────────────────────────────────────────
  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  // ── 5. Visibility check ────────────────────────────────────────────────────
  // Platform-level incidents (null site_id) are visible to all authenticated users.
  // Site-scoped incidents must be in the caller's accessible site list.
  if (incident.site_id !== null && !ctx.siteIds.includes(incident.site_id)) {
    // Return 404 not 403 — do not leak the existence of inaccessible incidents.
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  // ── 6. Write permission check ──────────────────────────────────────────────
  // Read-only roles (auditor, viewer, contractor) can see incidents but not mutate them.
  if (!ALL_WRITE_ROLES.has(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  return { ctx, incident, db };
}
