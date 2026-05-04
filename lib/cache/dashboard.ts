/**
 * lib/cache/dashboard.ts
 *
 * Dedicated cache layer for Command Center dashboard data.
 *
 * Wraps runOperatingBrain to provide fast cached reads for:
 *   - Hero strip (score + grade + voice line + KPI pills)
 *   - Priority action cards
 *
 * Cache hierarchy (fastest to slowest):
 *   1. In-process memory (lib/brain/cache.ts)
 *   2. Redis (Upstash)
 *   3. Full recompute (Supabase DB queries)
 *
 * All cache failures fall back transparently — Redis unavailability
 * never breaks the dashboard.
 */

import { runOperatingBrain } from "@/services/brain/operating-brain";
import type { BrainOutput } from "@/services/brain/operating-brain";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todaySAST(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type HeroStrip = {
  score:       number;
  grade:       string;
  voice:       string;
  systemHealth: BrainOutput["systemHealth"];
  kpis: {
    revenue:     number;
    revenueTarget: number;
    labourPct:   number;
    opsTasks: {
      completed: number;
      total:     number;
    };
  };
  lastUpdated: string;
};

export type PriorityActionCard = {
  title:       string;
  priority:    number;
  why:         string;
  owner:       string;
  moneyAtRisk: number | null;
};

// ── Getters ───────────────────────────────────────────────────────────────────

/**
 * Returns the dashboard hero strip for a site.
 * Backed by the full brain cache (in-memory L1 → Redis L2 → compute).
 */
export async function getHeroStrip(siteId: string): Promise<HeroStrip> {
  const brain = await runOperatingBrain(siteId, todaySAST());
  return {
    score:        brain.systemHealth.score,
    grade:        brain.systemHealth.grade,
    voice:        brain.voiceLine,
    systemHealth: brain.systemHealth,
    kpis: {
      revenue:      brain.forecastSummary?.projectedClose ?? 0,
      revenueTarget: 0, // filled by caller from site config if needed
      labourPct:    0,  // filled by caller from context
      opsTasks: {
        completed: 0,
        total:     0,
      },
    },
    lastUpdated: brain.timestamp,
  };
}

/**
 * Returns the ranked priority action queue for a site.
 * Backed by the full brain cache.
 */
export async function getPriorityActions(
  siteId: string,
): Promise<PriorityActionCard[]> {
  const brain = await runOperatingBrain(siteId, todaySAST());
  return brain.actionQueue.map((a) => ({
    title:       a.title,
    priority:    a.priority,
    why:         a.why,
    owner:       a.owner,
    moneyAtRisk: a.moneyAtRisk,
  }));
}
