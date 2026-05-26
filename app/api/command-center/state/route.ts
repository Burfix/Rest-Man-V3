/**
 * app/api/command-center/state/route.ts
 *
 * GET /api/command-center/state
 *
 * Canonical single-source-of-truth endpoint for the Command Center.
 *
 * Returns a fully computed CommandCenterState object — every panel MUST
 * read from this and MUST NOT compute its own score, grade, revenue gap,
 * labour risk, compliance status, or maintenance status.
 *
 * Response envelope:
 *   { data: CommandCenterState | null, error: string | null, meta: { ... } }
 *
 * Query params:
 *   ?site_id=<uuid>   — override the user's default site (head-office use)
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext, AuthError }  from "@/lib/auth/get-user-context";
import { resolvePageSite }            from "@/lib/auth/resolve-site";
import { buildCommandCenterState }    from "@/lib/command-center/build-command-center-state";
import type { CommandCenterApiResponse } from "@/lib/command-center/types";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const requestedAt = new Date().toISOString();
  const { searchParams } = request.nextUrl;
  const siteIdParam = searchParams.get("site_id") ?? undefined;

  // ── Auth ────────────────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err) {
    if (err instanceof AuthError && err.statusCode === 401) {
      const resp: CommandCenterApiResponse = {
        data: null,
        error: "Unauthorised",
        meta: { requestedAt, siteId: "" },
      };
      return NextResponse.json(resp, { status: 401 });
    }
    throw err;
  }

  if (!ctx?.siteId) {
    const resp: CommandCenterApiResponse = {
      data: null,
      error: "No site assigned. Contact your administrator.",
      meta: { requestedAt, siteId: "" },
    };
    return NextResponse.json(resp, { status: 403 });
  }

  const { siteId } = resolvePageSite(ctx, siteIdParam);
  const { orgId }  = ctx;

  // ── Build state ─────────────────────────────────────────────────────────────
  try {
    const { state } = await buildCommandCenterState(siteId, orgId ?? undefined);

    const resp: CommandCenterApiResponse = {
      data:  state,
      error: null,
      meta:  { requestedAt, siteId },
    };
    return NextResponse.json(resp);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";

    // Log for observability (Sentry will pick this up via integration)
    console.error("[command-center/state] build failed:", message, { siteId, orgId });

    const resp: CommandCenterApiResponse = {
      data:  null,
      error: "Failed to build Command Center state. Check server logs.",
      meta:  { requestedAt, siteId },
    };
    return NextResponse.json(resp, { status: 500 });
  }
}
