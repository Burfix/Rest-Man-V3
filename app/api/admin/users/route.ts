/**
 * GET  /api/admin/users       — list org users + roles
 * POST /api/admin/users       — invite a new user
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { inviteUserSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { sendInviteEmail } from "@/services/notifications/inviteEmail";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/users");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Get all roles for this org
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("user_id, role, site_id, region_id, is_active, granted_at")
      .eq("organisation_id", ctx.orgId!)
      .order("granted_at", { ascending: false });

    if (rolesErr) {
      logger.error("Failed to fetch user roles", { err: rolesErr });
      return NextResponse.json({ error: rolesErr.message }, { status: 500 });
    }

    // Get profile data for these users
    const rolesData = (roles ?? []) as any[];
    const userIds = Array.from(new Set(rolesData.map((r: any) => r.user_id as string)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name, status, last_seen_at")
      .in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    // Get site access
    const { data: siteAccess } = await supabase
      .from("user_site_access")
      .select("user_id, site_id")
      .in("user_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    // Merge data
    const profilesData = (profiles ?? []) as any[];
    const siteAccessData = (siteAccess ?? []) as any[];
    const profileMap = new Map(profilesData.map((p: any) => [p.id, p]));
    const accessMap = new Map<string, string[]>();
    for (const a of siteAccessData) {
      const arr = accessMap.get(a.user_id) ?? [];
      arr.push(a.site_id);
      accessMap.set(a.user_id, arr);
    }

    const users = userIds.map((uid) => {
      const profile = profileMap.get(uid) as any;
      const userRoles = rolesData.filter((r: any) => r.user_id === uid);
      return {
        id: uid,
        email: profile?.email ?? "unknown",
        full_name: profile?.full_name ?? null,
        status: profile?.status ?? "unknown",
        last_seen_at: profile?.last_seen_at ?? null,
        roles: userRoles,
        site_ids: accessMap.get(uid) ?? [],
      };
    });

    return NextResponse.json({ users });
  } catch (err) {
    logger.error("Admin users GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/admin/users");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(inviteUserSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // Check if profile already exists
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", d.email)
      .maybeSingle();

    let userId: string;

    if (existing) {
      userId = (existing as any).id;
    } else {
      // Create user directly (no email sent) to avoid SMTP hangs
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email: d.email,
        email_confirm: true,
        user_metadata: { full_name: d.full_name },
      });

      if (createErr || !newUser?.user) {
        logger.error("Failed to create user", { err: createErr });
        return NextResponse.json({ error: createErr?.message ?? "Failed to create user" }, { status: 500 });
      }

      userId = newUser.user.id;

      // Generate a password-reset link the admin can share
      const siteUrl = "https://si-cantina-concierge.vercel.app";
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: d.email,
        options: { redirectTo: `${siteUrl}/reset-password` },
      });

      const inviteLink = linkErr ? undefined : linkData?.properties?.action_link;
      if (linkErr) {
        logger.warn("Could not generate recovery link, user still created", { err: linkErr });
      }

      // Auto-send invite email via Resend (non-blocking — doesn't hang)
      let emailSent = false;
      if (inviteLink) {
        emailSent = await sendInviteEmail({
          to: d.email,
          name: d.full_name,
          role: d.role,
          inviteLink,
        });
      }

      // Upsert profile row to match the auth user
      await supabase.from("profiles").upsert({
        id: userId,
        email: d.email,
        full_name: d.full_name,
        status: "invited",
      } as any, { onConflict: "id" });

      // Create role assignment
      const { error: roleErr } = await supabase.from("user_roles").insert({
        user_id: userId,
        organisation_id: ctx.orgId,
        role: d.role,
        site_id: d.site_id ?? null,
        region_id: d.region_id ?? null,
        granted_by: ctx.userId,
      } as any);

      if (roleErr) {
        logger.error("Failed to assign role", { err: roleErr });
        return NextResponse.json({ error: roleErr.message }, { status: 500 });
      }

      // Grant site access if a site was specified
      if (d.site_id) {
        await supabase.from("user_site_access").insert({
          user_id: userId,
          site_id: d.site_id,
          granted_by: ctx.userId,
        } as any).then(() => {}); // ignore duplicate
      }

      // Audit log
      await supabase.from("access_audit_log").insert({
        actor_user_id: ctx.userId,
        target_user_id: userId,
        action: "user.invited",
        metadata: { email: d.email, role: d.role, site_id: d.site_id },
      } as any);

      logger.info("User invited", { email: d.email, userId });

      return NextResponse.json({
        userId,
        email: d.email,
        role: d.role,
        inviteLink,
        emailSent,
      }, { status: 201 });
    }

    // User already exists - just add the role
    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: userId,
      organisation_id: ctx.orgId,
      role: d.role,
      site_id: d.site_id ?? null,
      region_id: d.region_id ?? null,
      granted_by: ctx.userId,
    } as any);

    if (roleErr) {
      logger.error("Failed to assign role", { err: roleErr });
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }

    // Grant site access if a site was specified
    if (d.site_id) {
      await supabase.from("user_site_access").insert({
        user_id: userId,
        site_id: d.site_id,
        granted_by: ctx.userId,
      } as any).then(() => {}); // ignore duplicate
    }

    // Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: userId,
      action: "user.role_added",
      metadata: { email: d.email, role: d.role, site_id: d.site_id },
    } as any);

    return NextResponse.json({ userId, email: d.email, role: d.role }, { status: 201 });
  } catch (err) {
    logger.error("Admin users POST failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
