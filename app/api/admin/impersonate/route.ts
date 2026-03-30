/**
 * POST   /api/admin/impersonate  — start impersonation
 * DELETE /api/admin/impersonate  — stop impersonation
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiGuard } from "@/lib/auth/api-guard";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const COOKIE = "fs-impersonate";
const MAX_AGE = 3600; // 1 hour

export async function POST(req: NextRequest) {
  const guard = await apiGuard(null, "POST /api/admin/impersonate");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  if (!isSuperAdmin(ctx)) {
    return NextResponse.json({ error: "Requires super_admin" }, { status: 403 });
  }

  try {
    const { target_user_id } = await req.json();
    if (!target_user_id || typeof target_user_id !== "string") {
      return NextResponse.json({ error: "target_user_id required" }, { status: 400 });
    }

    // Verify target exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", target_user_id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Set impersonation cookie on the response
    const res = NextResponse.json({
      impersonating: true,
      target: {
        id: (profile as any).id,
        email: (profile as any).email,
        full_name: (profile as any).full_name,
      },
    });
    res.cookies.set(COOKIE, target_user_id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: MAX_AGE,
      path: "/",
    });

    // Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id,
      action: "impersonation.started",
      metadata: { target_email: (profile as any).email },
    } as any);

    logger.info("Impersonation started", {
      actor: ctx.email,
      target: (profile as any).email,
    });

    return res;
  } catch (err) {
    logger.error("Impersonate POST failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  // Use a lightweight auth check — apiGuard may fail when impersonating a
  // user with no role/site, and we still need to allow ending impersonation.
  try {
    const cookieStore = cookies();
    const targetId = (cookieStore as any).get(COOKIE)?.value;

    // Build response and clear cookie directly on it (cookies().set may not
    // merge into NextResponse.json reliably in Next.js 14 Route Handlers)
    const res = NextResponse.json({ impersonating: false });
    res.cookies.set(COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 0,
      path: "/",
    });

    // Best-effort audit log
    if (targetId) {
      try {
        const guard = await apiGuard(null, "DELETE /api/admin/impersonate");
        if (!guard.error) {
          const { ctx, supabase } = guard;
          await supabase.from("access_audit_log").insert({
            actor_user_id: ctx.isImpersonating ? ctx.realUserId : ctx.userId,
            target_user_id: targetId,
            action: "impersonation.ended",
            metadata: {},
          } as any);
        }
      } catch {
        // Audit log is best-effort — don't block the cookie clear
      }
    }

    return res;
  } catch (err) {
    logger.error("Impersonate DELETE failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
