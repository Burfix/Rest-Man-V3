/**
 * POST /api/admin/adoption/events
 *
 * Receives client-side usage events from the browser and writes them to
 * platform_usage_events. Authenticated users only — no super_admin check
 * because every logged-in user should be able to report their own events.
 *
 * Rate-limited by Vercel Edge at the infrastructure level.
 * Input is validated with Zod before any DB write.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserContext } from "@/lib/auth/get-user-context";
import { trackEvent, openSession, closeSession } from "@/lib/adoption/event-tracker";
import { logger } from "@/lib/logger";

const eventSchema = z.object({
  eventType: z.enum(["login", "page_view", "feature_use", "sync_use", "session_end"]),
  featureName:      z.string().max(64).optional(),
  pagePath:         z.string().max(512).optional(),
  durationSeconds:  z.number().int().min(0).max(86400).optional(),
  sessionId:        z.string().max(128).optional(),
  metadata:         z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getUserContext();

    const raw = await req.json().catch(() => ({}));
    const parsed = eventSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid event payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { eventType, featureName, pagePath, durationSeconds, sessionId, metadata } = parsed.data;

    const userAgent = req.headers.get("user-agent") ?? undefined;
    const rawIp     =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined;

    await trackEvent({
      userId:          ctx.userId,
      orgId:           ctx.orgId ?? undefined,
      siteId:          ctx.siteId || undefined,
      eventType,
      featureName,
      pagePath,
      durationSeconds,
      metadata:        { ...metadata, sessionId },
      userAgent,
      rawIp,
    });

    // For session_end events, also close the user_sessions row if a session
    // ID was provided. The session ID from the client matches what was opened.
    if (eventType === "session_end" && sessionId) {
      const pageCount  = typeof metadata?.page_count  === "number" ? metadata.page_count  : 0;
      const eventCount = typeof metadata?.event_count === "number" ? metadata.event_count : 0;
      // Session rows are keyed by DB uuid, not client-generated sessionId.
      // We close the most recently opened unclosed session for this user.
      await closeSessionByUser(ctx.userId, pageCount, eventCount);
    }

    // For login events, open a new session row
    if (eventType === "login") {
      await openSession({
        userId: ctx.userId,
        orgId:  ctx.orgId ?? undefined,
        siteId: ctx.siteId || undefined,
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    // Auth errors → 401; anything else → 500 (swallowed — tracking must not break UX)
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 401) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    logger.warn("adoption.events: unexpected error", { err: String(err) });
    // Return 200 to prevent client retry storms
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

// ── Close the latest open session for a user ─────────────────────────────────

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

async function closeSessionByUser(
  userId:     string,
  pageCount:  number,
  eventCount: number,
): Promise<void> {
  try {
    const db = getServiceRoleClient();
    // Find the most recent unclosed session for this user
    const { data } = await (db as any)
      .from("user_sessions")
      .select("id")
      .eq("user_id", userId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if ((data as { id?: string } | null)?.id) {
      await closeSession((data as { id: string }).id, pageCount, eventCount);
    }
  } catch {
    // Silently swallow — session tracking is best-effort
  }
}
