/**
 * lib/scores/persistOperatingScore.ts
 *
 * Fire-and-forget persistence for the operating_score_cache table.
 *
 * Rules:
 *  - Uses the service-role client internally — the os_cache_service RLS policy
 *    grants writes to service role only; the user-scoped client is always rejected.
 *  - NEVER throws — score persistence must never break the UI render path.
 *  - Always UPSERT (ON CONFLICT store_id, score_date) so repeated scoring
 *    within the same business day overwrites with the latest values.
 *  - Always call with `void persistOperatingScore(...)` so the caller does
 *    not await it and the render path is not blocked.
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

export async function persistOperatingScore(
  payload: {
    storeId:    string;
    scoreDate:  string;   // "YYYY-MM-DD" in SAST
    totalScore: number;
    grade:      string;
    breakdown:  Record<string, unknown>;
  },
): Promise<void> {
  if (!payload.storeId || !payload.scoreDate) {
    console.warn("[persistOperatingScore] Missing storeId or scoreDate — skipping", payload);
    return;
  }

  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("operating_score_cache")
      .upsert(
        {
          store_id:    payload.storeId,
          score_date:  payload.scoreDate,
          total_score: Math.round(payload.totalScore),
          grade:       payload.grade,
          breakdown:   payload.breakdown,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "store_id,score_date" },
      );

    if (error) {
      console.error("[persistOperatingScore] Upsert failed:", error.message, {
        storeId:   payload.storeId,
        scoreDate: payload.scoreDate,
      });
    }
  } catch (err) {
    console.error("[persistOperatingScore] Unexpected error:", err);
  }
}
