/**
 * POST /api/preferences/site
 *
 * Persists the user's selected site via the fs-site-id cookie.
 * Accepts { siteId: string } — "all" is valid sentinel for aggregate mode.
 * Only available to multi-site roles.
 *
 * This is a server action replacement for cookie writes from client code.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard }                  from "@/lib/auth/api-guard";
import { PERMISSIONS }               from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

const MULTI_SITE_ROLES = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);
const COOKIE_NAME      = "fs-site-id";
const MAX_AGE          = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "POST /api/preferences/site");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!MULTI_SITE_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Not a multi-site role" }, { status: 403 });
  }

  let body: { siteId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { siteId } = body;
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  // Allow "all" or any site in the user's accessible list
  if (siteId !== "all" && !ctx.siteIds.includes(siteId)) {
    return NextResponse.json({ error: "Access denied: site not in your accessible list" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, siteId });
  res.cookies.set(COOKIE_NAME, siteId, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   MAX_AGE,
    path:     "/",
  });
  return res;
}

export async function DELETE() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "DELETE /api/preferences/site");
  if (guard.error) return guard.error;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
