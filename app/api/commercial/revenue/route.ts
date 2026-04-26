/**
 * POST /api/commercial/revenue
 *
 * Records a commercial revenue event (payment, setup fee, addon, etc.)
 * for a given client.
 *
 * Body: { client_id, amount, event_type?, description?, event_date? }
 *
 * Auth: super_admin | executive | head_office | tenant_owner only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";

export const dynamic = "force-dynamic";

const ALLOWED       = ["super_admin", "executive", "head_office", "tenant_owner"];
const VALID_TYPES   = ["payment", "refund", "credit", "setup_fee", "addon"] as const;
const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE       = /^\d{4}-\d{2}-\d{2}$/;

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  let ctx;
  try { ctx = await getUserContext(); }
  catch (err) { return authErrorResponse(err); }

  if (!ALLOWED.includes(ctx.role ?? "")) {
    return NextResponse.json({ data: null, error: "Insufficient permissions" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 }); }

  const { client_id, amount, event_type, description, event_date } = body;

  // Validate required fields
  if (typeof client_id !== "string" || !UUID_RE.test(client_id)) {
    return NextResponse.json({ data: null, error: "Valid client_id (UUID) is required" }, { status: 400 });
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    return NextResponse.json({ data: null, error: "Non-zero numeric amount is required" }, { status: 400 });
  }

  const effectiveType = VALID_TYPES.includes(event_type as typeof VALID_TYPES[number])
    ? (event_type as string)
    : "payment";

  const effectiveDate = typeof event_date === "string" && DATE_RE.test(event_date)
    ? event_date
    : new Date().toISOString().slice(0, 10);

  const db = serviceDb();

  // Verify client exists
  const { data: clientRow } = await db
    .from("commercial_clients")
    .select("id")
    .eq("id", client_id)
    .single();

  if (!clientRow) {
    return NextResponse.json({ data: null, error: "Client not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("commercial_revenue_events")
    .insert({
      client_id,
      amount:      parsedAmount,
      event_type:  effectiveType,
      description: typeof description === "string" ? description.slice(0, 500) : null,
      event_date:  effectiveDate,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, error: null }, { status: 201 });
}
