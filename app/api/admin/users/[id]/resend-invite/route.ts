/**
 * POST /api/admin/users/[id]/resend-invite — resend invite email
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    // 2. Generate a new invite link (doesn't send email, just creates the link)
    const siteUrl = "https://ops-engine.vercel.app";
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: profileData.email,
      options: {
        data: { full_name: profileData.full_name },
        redirectTo: `${siteUrl}/reset-password`,
      },
    });

    if (linkErr || !linkData?.user) {
      logger.error("Failed to generate invite link", { err: linkErr, email: profileData.email });
      return NextResponse.json({ error: linkErr?.message ?? "Failed to generate invite" }, { status: 500 });
    }

    // 3. Update profile if user ID changed
    const newUserId = linkData.user.id;
    if (newUserId !== targetId) {
      // Migrate to new user ID
      await supabase.from("profiles").delete().eq("id", targetId);
      await supabase.from("profiles").upsert({
        id: newUserId,
        email: profileData.email,
        full_name: profileData.full_name,
        status: "invited",
      } as any, { onConflict: "id" });

      await supabase
        .from("user_roles")
        .update({ user_id: newUserId } as any)
        .eq("user_id", targetId);

      await supabase
        .from("user_site_access")
        .update({ user_id: newUserId } as any)
        .eq("user_id", targetId);
    }

    // 4. Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: newUserId,
      action: "user.invite_resent",
      metadata: { email: profileData.email },
    } as any);

    logger.info("Generated new invite link", { email: profileData.email, newUserId });

    // Return the invite link - the admin can share it manually
    // The link contains the token needed to complete signup
    const inviteLink = linkData.properties?.action_link;

    return NextResponse.json({
      success: true,
      email: profileData.email,
      userId: newUserId,
      inviteLink, // Admin can copy and send manually if email doesn't work
    });
  } catch (err) {
    logger.error("Resend invite failed", { err, targetId });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
