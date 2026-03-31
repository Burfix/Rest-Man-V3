/**
 * POST /api/accountability/compute-scores?date=YYYY-MM-DD
 * Triggers daily score computation for all managers.
 * Protected by CRON_SECRET (used by Vercel cron at 23:55 SAST).
 */

import { NextRequest, NextResponse } from "next/server";
import { computeAndStoreDailyScores } from "@/services/accountability/score-calculator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const date = searchParams.get("date") ?? today;

  const result = await computeAndStoreDailyScores(date);

  return NextResponse.json({ ok: true, date, ...result });
}
