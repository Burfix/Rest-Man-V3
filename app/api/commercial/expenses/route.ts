/**
 * POST /api/commercial/expenses
 *
 * Records a platform operating expense, optionally attributed to a client.
 *
 * Body: { category, description, amount, client_id?, expense_date? }
 *
 * Auth: super_admin | executive | head_office | tenant_owner only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";

export const dynamic = "force-dynamic";

const ALLOWED = ["super_admin", "executive", "head_office", "tenant_owner"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { category, description, amount, client_id, expense_date } = body;

  // Validate required fields
  if (typeof category !== "string" || category.trim().length === 0) {
    return NextResponse.json({ data: null, error: "category is required" }, { status: 400 });
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return NextResponse.json({ data: null, error: "description is required" }, { status: 400 });
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ data: null, error: "Positive numeric amount is required" }, { status: 400 });
  }

  // Optional client_id — validate if provided
  let effectiveClientId: string | null = null;
  if (client_id !== undefined && client_id !== null && client_id !== "") {
    if (typeof client_id !== "string" || !UUID_RE.test(client_id)) {
      return NextResponse.json({ data: null, error: "client_id must be a valid UUID" }, { status: 400 });
    }
    effectiveClientId = client_id;
  }

  const effectiveDate = typeof expense_date === "string" && DATE_RE.test(expense_date)
    ? expense_date
    : new Date().toISOString().slice(0, 10);

  const db = serviceDb();

  const { data, error } = await db
    .from("commercial_expenses")
    .insert({
      category:     category.trim().slice(0, 100),
      description:  description.trim().slice(0, 500),
      amount:       parsedAmount,
      client_id:    effectiveClientId,
      expense_date: effectiveDate,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, error: null }, { status: 201 });
}
