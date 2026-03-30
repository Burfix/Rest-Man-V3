/**
 * POST /api/admin/users/[id]/resend-invite — resend invite email
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/admin/users/[id]/resend-invite");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const targetId = params.id;

  try {
    // 1. Verify the user exists and is in "invited" status
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, full_name, status")
      .eq("id", targetId)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const profileData = profile as { id: string; email: string; full_name: string | null; status: string };

    if (profileData.status !== "invited") {
      return NextResponse.json(
        { error: "User has already accepted their invite or has a different status" },
        { status: 400 }
      );
    }

    // 2. Delete the existing auth user (Supabase doesn't have a "resend invite" method,
    //    so we delete and re-invite)
    const { error: deleteErr } = await supabase.auth.admin.deleteUser(targetId);
    if (deleteErr) {
      logger.warn("Could not delete existing auth user for re-invite", { targetId, err: deleteErr });
      // Continue anyway - user may not exist in auth yet
    }

    // 3. Re-invite the user
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ops-engine.vercel.app";
    const { data: authUser, error: authErr } = await supabase.auth.admin.inviteUserByEmail(
      profileData.email,
      {
        data: { full_name: profileData.full_name },
        redirectTo: `${siteUrl}/reset-password`,
      }
    );

    if (authErr || !authUser?.user) {
      logger.error("Failed to resend invite", { err: authErr, email: profileData.email });
      return NextResponse.json({ error: authErr?.message ?? "Failed to send invite" }, { status: 500 });
    }

    // 4. Update the profile with the new auth user ID (in case it changed)
    const newUserId = authUser.user.id;
    if (newUserId !== targetId) {
      // The auth user got a new ID - we need to update all references
      // Update profile
      await supabase.from("profiles").delete().eq("id", targetId);
      await supabase.from("profiles").upsert({
        id: newUserId,
        email: profileData.email,
        full_name: profileData.full_name,
        status: "invited",
      } as any, { onConflict: "id" });

      // Migrate roles
      await supabase
        .from("user_roles")
        .update({ user_id: newUserId } as any)
        .eq("user_id", targetId);

      // Migrate site access
      await supabase
        .from("user_site_access")
        .update({ user_id: newUserId } as any)
        .eq("user_id", targetId);
    }

    // 5. Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: newUserId,
      action: "user.invite_resent",
      metadata: { email: profileData.email },
    } as any);

    logger.info("Resent invite", { email: profileData.email, newUserId });

    return NextResponse.json({
      success: true,
      email: profileData.email,
      userId: newUserId,
    });
  } catch (err) {
    logger.error("Resend invite failed", { err, targetId });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
