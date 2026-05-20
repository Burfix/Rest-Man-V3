/**
 * GET /api/commercial/clients
 *
 * Returns all commercial clients with aggregated financials, linked site
 * names, subscription info, and recent revenue events.
 *
 * Auth: super_admin | executive | head_office | tenant_owner only.
 */

import { NextResponse } from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { getCommercialClients } from "@/lib/commercial/queries";

export const dynamic = "force-dynamic";

const ALLOWED = ["super_admin", "executive", "head_office", "tenant_owner"];

export async function GET() {
  let ctx;
  try { ctx = await getUserContext(); }
  catch (err) { return authErrorResponse(err); }

  if (!ALLOWED.includes(ctx.role ?? "")) {
    return NextResponse.json({ data: null, error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const data = await getCommercialClients();
    return NextResponse.json({ data, error: null });
  } catch {
    return NextResponse.json({ data: null, error: "Failed to load clients" }, { status: 500 });
  }
}
