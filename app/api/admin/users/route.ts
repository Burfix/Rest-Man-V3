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
        // super_admin sees ALL users across ALL orgs via the team_members_all view
      // everyone else is scoped to their own org
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

  const body = await validateBody(req, inviteUserSchema);
    if (body.error) return body.error;
    const { email, role, siteId, fullName } = body.data;

  try {
        // Resolve organisation_id from the site — never hardcode org UUIDs
      const { data: site, error: siteErr } = await supabase
          .from("sites")
          .select("id, name, organisation_id")
          .eq("id", siteId)
          .single();

      if (siteErr || !site) {
              return NextResponse.json({ error: `Site not found: ${siteId}` }, { status: 404 });
      }

      const organisationId = site.organisation_id;

      // Callers can only invite into their own org unless super_admin
      if (ctx.role !== "super_admin" && ctx.orgId !== organisationId) {
              return NextResponse.json({ error: "Not authorised to invite users to this organisation" }, { status: 403 });
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ops.forgestackafrica.dev";

      // Use admin client for invite (requires service role key)
      const { createClient } = await import("@supabase/supabase-js");
        const adminClient = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
              );

      const { 
