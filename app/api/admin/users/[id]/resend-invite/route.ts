/**
 * POST /api/admin/users/[id]/resend-invite — resend invite email
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";
import { sendInviteEmail } from "@/services/notifications/inviteEmail";

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
    // 1. Verify the user exists and is in "invited" or "active" status
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, full_name, status")
      .eq("id", targetId)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const profileData = profile as { id: string; email: string; full_name: string | null; status: string };

    if (profileData.status !== "invited" && profileData.status !== "active") {
      return NextResponse.json(
        { error: "Cannot send a reset link to a user with this status" },
        { status: 400 }
      );
    }

    // 2. Look up the user's organisation_id, then get the org name separately
    // (avoids relying on Supabase join types which may not be generated for this relation)
    let organisationName = "ForgeStack";
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("organisation_id")
      .eq("user_id", targetId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (roleRow?.organisation_id) {
      const { data: orgRow } = await supabase
        .from("organisations")
        .select("name")
        .eq("id", roleRow.organisation_id)
        .single();
      if (orgRow?.name) organisationName = orgRow.name;
    }

    // 3. Generate a recovery (password-reset) link
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ops.forgestackafrica.dev";
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: profileData.email,
      options: { redirectTo: `${siteUrl}/reset-password` },
    });

    if (linkErr) {
      logger.error("Failed to generate recovery link", { err: linkErr, email: profileData.email });
      return NextResponse.json({ error: linkErr?.message ?? "Failed to generate link" }, { status: 500 });
    }

    const auditAction = profileData.status === "invited" ? "user.invite_resent" : "user.password_reset_sent";

    // 4. Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: targetId,
      action: auditAction,
      metadata: { email: profileData.email },
    } as any);

    logger.info("Generated new invite link", { email: profileData.email, targetId, organisationName });

    const inviteLink = linkData?.properties?.action_link;

    // 5. Send via Resend with correct org name
    let emailSent = false;
    if (inviteLink) {
      emailSent = await sendInviteEmail({
        to: profileData.email,
        name: profileData.full_name ?? undefined,
        organisationName,
        inviteLink,
      });
    }

    return NextResponse.json({
      success: true,
      email: profileData.email,
      userId: targetId,
      inviteLink,
      emailSent,
    });
  } catch (err) {
    logger.error("Resend invite failed", { err, targetId });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
