/**
 * GET /api/admin/impersonate/status — check current impersonation state
 *
 * Uses a lightweight cookie check so the banner always shows, even when
 * the impersonated user has no role/site assigned (which would cause
 * getUserContext to throw and hide the "end impersonation" button).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = cookies();
    const impersonateId = (cookieStore as any).get("fs-impersonate")?.value;

    if (!impersonateId) {
      return NextResponse.json({ impersonating: false });
    }

    // Look up profile of impersonated user (service role, no RLS)
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

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
