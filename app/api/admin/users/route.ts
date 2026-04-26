/**
 * GET  /api/admin/users      - list users (all orgs for super_admin, scoped for others)
 * POST /api/admin/users      - invite a new user
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { inviteUserSchema, validateBody } from "@/lib/validation/schemas";
import { inviteUserDtoToInternal, inviteUserInternalToDb } from "@/lib/mappers/userMapper";
import { logger } from "@/lib/logger";
import { sendInviteEmail } from "@/services/notifications/inviteEmail";
import type { VUser } from "@/lib/admin/contractTypes";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
        const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/users");
        if (guard.error) return guard.error;
        const { ctx, supabase } = guard;

  try {
            const isSuperAdmin = ctx.role === "super_admin";

          // Read from the contract-layer view v_users (migration 065).
          // site_ids is a real uuid array; this is the canonical source for team counts.
          let query = supabase
              .from("v_users")
              .select("user_id, email, full_name, status, last_seen_at, joined_at, primary_role, org_id, org_name, role_granted_at, role_is_active, site_ids")
              .order("joined_at", { ascending: false });

          if (!isSuperAdmin) {
                      query = query.eq("org_id", ctx.orgId!);
          }

          const { data: rows, error: fetchErr } = await query;

          if (fetchErr) {
                      logger.error("Failed to fetch team members", { err: fetchErr });
                      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
          }

          // Map v_users rows to the UserEntry shape expected by the admin UI.
          // The roles array is derived from primary_role + role metadata.
          const users = ((rows as VUser[] | null) ?? []).map((r) => ({
            id: r.user_id,
            email: r.email,
            full_name: r.full_name,
            status: r.status,
            last_seen_at: r.last_seen_at,
            roles: r.primary_role
              ? [{
                  role: r.primary_role,
                  site_id: null as string | null,
                  region_id: null as string | null,
                  is_active: r.role_is_active,
                  granted_at: r.role_granted_at ?? "",
                }]
              : [],
            site_ids: r.site_ids ?? [],
          }));

          return NextResponse.json({ users, total: users.length });
  } catch (err) {
            logger.error("Unexpected error in GET /api/admin/users", { err });
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
        const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/admin/users");
        if (guard.error) return guard.error;
        const { ctx, supabase } = guard;

  const raw = await req.json();
        const v = validateBody(inviteUserSchema, raw);
        if (!v.success) return v.response;
        const user = inviteUserDtoToInternal(v.data);

  try {
            if (!user.siteId) {
                      return NextResponse.json({ error: "site_id is required" }, { status: 400 });
            }

            const { data: site, error: siteErr } = await supabase
              .from("sites")
              .select("id, name, organisation_id")
              .eq("id", user.siteId)
              .single();

          if (siteErr || !site) {
                      return NextResponse.json({ error: `Site not found: ${user.siteId}` }, { status: 404 });
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

          const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(user.email, {
                      redirectTo: `${siteUrl}/auth/confirm`,
                      data: { full_name: user.fullName || "", invited_to_site: site.name, role: user.role },
          });

          if (inviteErr) {
                      logger.error("Supabase invite failed", { err: inviteErr });
                      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
          }

          const invitedUserId = inviteData.user.id;

          const profileDb = inviteUserInternalToDb(user);
          await adminClient.from("profiles").upsert(
                { id: invitedUserId, email: profileDb.email, full_name: profileDb.full_name || "", status: "invited", updated_at: new Date().toISOString() },
                { onConflict: "id" }
                    );

          await adminClient.from("user_roles").upsert(
                { user_id: invitedUserId, organisation_id: organisationId, site_id: profileDb.site_id, role: profileDb.role, is_active: true, granted_by: ctx.userId, granted_at: new Date().toISOString() },
                { onConflict: "user_id,organisation_id,site_id,role" }
                    );

          await adminClient.from("user_site_access").upsert(
                { user_id: invitedUserId, site_id: profileDb.site_id, granted_by: ctx.userId, created_at: new Date().toISOString() },
                { onConflict: "user_id,site_id" }
                    );

          await sendInviteEmail({ to: user.email, name: user.fullName || user.email, role: user.role, inviteLink: `${siteUrl}/login` });

          return NextResponse.json({ success: true, userId: invitedUserId, organisationId, siteId: user.siteId, role: user.role });
  } catch (err) {
            logger.error("Unexpected error in POST /api/admin/users", { err });
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
