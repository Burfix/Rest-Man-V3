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

    // 2. Generate a recovery (password-reset) link — avoids SMTP hang from invite type
    const siteUrl = "https://si-cantina-concierge.vercel.app";
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: profileData.email,
      options: { redirectTo: `${siteUrl}/reset-password` },
    });

    if (linkErr) {
      logger.error("Failed to generate recovery link", { err: linkErr, email: profileData.email });
      return NextResponse.json({ error: linkErr?.message ?? "Failed to generate link" }, { status: 500 });
    }

    // 3. Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: targetId,
      action: "user.invite_resent",
      metadata: { email: profileData.email },
    } as any);

    logger.info("Generated new invite link", { email: profileData.email, targetId });

    const inviteLink = linkData?.properties?.action_link;

    // Auto-send invite email via Resend
    let emailSent = false;
    if (inviteLink) {
      emailSent = await sendInviteEmail({
        to: profileData.email,
        name: profileData.full_name ?? undefined,
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
