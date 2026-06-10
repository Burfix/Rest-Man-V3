import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { invalidateBrainCacheForSite } from "@/lib/brain/cache";
import { runOperatingBrain } from "@/services/brain/operating-brain";
import { todayISO } from "@/lib/utils";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const guard = await apiGuard(null, "POST /api/brain/invalidate");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  invalidateBrainCacheForSite(ctx.siteId);

  try {
    const brain = await runOperatingBrain(ctx.siteId, todayISO(), { caller: "sync_invalidate" });
    return NextResponse.json({
      ok: true,
      score: brain.systemHealth.score,
      grade: brain.systemHealth.grade,
      recomputedAt: brain.timestamp,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/brain/invalidate" } });
    return NextResponse.json({ ok: false, error: "Brain recompute failed — page refresh will retry" });
  }
}
