/**
 * GET  /api/admin/users      - list users (all orgs for super_admin, scoped for others)
 * POST /api/admin/users      - invite a new user
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { inviteUserSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { sendInviteEmail } from "@/services/notifications/inviteEmail";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
        const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/users");
        if (guard.error) return guard.error;
        const { ctx, supabase } = guard;

  try {
            const isSuperAdmin = ctx.role === "super_admin";

          let query = supabase
              .from("team_members_all")
              .select("user_id, email, full_name, profile_status, last_seen_at, primary_role, primary_org_id, primary_org_name, role_is_active, all_org_names, all_site_names, all_site_ids, joined_at")
              .order("joined_at", { ascending: false });

          if (!isSuperAdmin) {
                      query = query.eq("primary_org_id", ctx.orgId!);
          }

          const { data: members, error: membersErr } = await query;

          if (membersErr) {
                      logger.error("Failed to fetch team members", { err: membersErr });
                      return NextResponse.json({ error: membersErr.message }, { status: 500 });
          }

          return NextResponse.json({ users: members ?? [], total: (members ?? []).length });
  } catch (err) {
            logger.error("Unexpected error in GET /api/admin/users", { err });
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
        const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/admin/users");
        if (guard.error) return guard.error;
        const { ctx, supabase } = guard;

  const body = await validateBody(inviteUserSchema, req);
        if (!body.success) return body.response;
        const { email, role, site_id, full_name, region_id } = body.data;
        const siteId = site_id ?? null;
        const fullName = full_name;
        const regionId = region_id ?? null;

  try {
            if (!siteId) {
                      return NextResponse.json({ error: "site_id is required" }, { status: 400 });
            }

            const { data: site, error: siteErr } = await supabase
              .from("sites")
              .select("id, name, organisation_id")
              .eq("id", siteId)
              .single();

          if (siteErr || !site) {
                      return NextResponse.json({ error: `Site not found: ${siteId}` }, { status: 404 });
          }

          const organisationId = site.organisation_id;

          if (ctx.role !== "super_admin" && ctx.orgId !== organisationId) {
                      return NextResponse.json({ error: "Not authorised to invite users to this organisation" }, { status: 403 });
          }

          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ops.forgestackafrica.dev";

          const { createClient } = await import("@supabase/supabase-js");
            const adminClient = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.SUPABASE_SERVICE_ROLE_KEY!,
                  { auth: { autoRefreshToken: false, persistSession: false } }
                      );

          const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
                      redirectTo: `${siteUrl}/auth/confirm`,
                      data: { full_name: fullName || "", invited_to_site: site.name, role },
          });

          if (inviteErr) {
                      logger.error("Supabase invite failed", { err: inviteErr });
                      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
          }

          const invitedUserId = inviteData.user.id;

          await adminClient.from("profiles").upsert(
                { id: invitedUserId, email, full_name: fullName || "", status: "invited", updated_at: new Date().toISOString() },
                { onConflict: "id" }
                    );

          await adminClient.from("user_roles").upsert(
                { user_id: invitedUserId, organisation_id: organisationId, site_id: siteId, role, is_active: true, granted_by: ctx.userId, granted_at: new Date().toISOString() },
                { onConflict: "user_id,organisation_id,site_id,role" }
                    );

          await adminClient.from("user_site_access").upsert(
                { user_id: invitedUserId, site_id: siteId, granted_by: ctx.userId, created_at: new Date().toISOString() },
                { onConflict: "user_id,site_id" }
                    );

          await sendInviteEmail({ to: email, name: fullName || email, role, inviteLink: `${siteUrl}/login` });

          return NextResponse.json({ success: true, userId: invitedUserId, organisationId, siteId, role });
  } catch (err) {
            logger.error("Unexpected error in POST /api/admin/users", { err });
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
