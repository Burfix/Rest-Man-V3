/**
 * GET /api/admin/impersonate/status — check current impersonation state
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(null, "GET /api/admin/impersonate/status");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (ctx.isImpersonating) {
    return NextResponse.json({
      impersonating: true,
      targetUserId: ctx.userId,
      targetEmail: ctx.email,
      targetRole: ctx.role,
      realUserId: ctx.realUserId,
      realEmail: ctx.realEmail,
    });
  }

  return NextResponse.json({ impersonating: false });
}
