/**
 * GET /api/admin/impersonate/status — check current impersonation state
 *
 * Uses a lightweight session + cookie check so the banner always shows,
 * even when the impersonated user has no role/site assigned (which would
 * cause getUserContext to throw and hide the "end impersonation" button).
 *
 * Auth: requires a valid Supabase session (impersonated user's session is
 * still a valid session — they just may have no role/site in the DB).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Require a valid session — unauthenticated callers get nothing
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ impersonating: false }, { status: 401 });
    }

    const cookieStore = cookies();
    const impersonateId = (cookieStore as any).get("fs-impersonate")?.value;

    if (!impersonateId) {
      return NextResponse.json({ impersonating: false });
    }

    // Look up profile of impersonated user (service role, no RLS)
    const db = getServiceRoleClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const { data: profile } = await db
      .from("profiles")
      .select("email, full_name")
      .eq("id", impersonateId)
      .maybeSingle();

    // Look up impersonated user's role
    const { data: roles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", impersonateId)
      .eq("is_active", true)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(1);

    return NextResponse.json({
      impersonating: true,
      targetUserId: impersonateId,
      targetEmail: (profile as any)?.email ?? "unknown",
      targetRole: roles?.[0]?.role ?? "unknown",
    });
  } catch {
    return NextResponse.json({ impersonating: false });
  }
}
