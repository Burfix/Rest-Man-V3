/**
 * app/api/manager-contacts/route.ts
 *
 * GET  /api/manager-contacts?site_id=...  — list active manager contacts for a site
 * POST /api/manager-contacts              — create a new manager contact
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// E.164 phone validation
const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;

const CreateContactSchema = z.object({
  site_id:           z.string().uuid("site_id must be a UUID"),
  name:              z.string().min(1).max(120),
  role:              z.string().min(1).max(80),
  phone_whatsapp:    z.string().regex(E164_REGEX, "phone_whatsapp must be E.164 format, e.g. +27821234567"),
  is_active:         z.boolean().optional().default(true),
  alert_preferences: z.record(z.unknown()).optional().default({}),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "GET /api/manager-contacts");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const siteId = req.nextUrl.searchParams.get("site_id") ?? ctx.siteId;

  // Non-HQ users can only view their own site's contacts
  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  const resolvedSiteId = isHq ? siteId : ctx.siteId;

  const db = createServerClient();
  const { data, error } = await db
    .from("manager_contacts")
    .select("id, name, role, phone_whatsapp, is_active, alert_preferences, created_at")
    .eq("site_id",   resolvedSiteId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    logger.error("GET /api/manager-contacts failed", { error: error.message, siteId: resolvedSiteId });
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
  }

  // Never expose full phone numbers to non-HQ users
  const contacts = (data ?? []).map((c) => ({
    ...c,
    phone_whatsapp: isHq
      ? c.phone_whatsapp
      : maskPhone(c.phone_whatsapp),
  }));

  return NextResponse.json({ contacts });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "POST /api/manager-contacts");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  // Only HQ / area managers may create contacts
  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  if (!isHq) {
    return NextResponse.json(
      { error: "Only HQ users can create manager contacts" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const db = createServerClient();
  const { data, error } = await db
    .from("manager_contacts")
    .insert(parsed.data)
    .select()
    .single();

  if (error || !data) {
    logger.error("POST /api/manager-contacts failed", { error: error?.message, userId: ctx.userId });
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  // +27821234567 → +278****567
  if (phone.length < 8) return "****";
  return phone.slice(0, 4) + "****" + phone.slice(-3);
}
