/**
 * lib/adoption/scores.ts
 *
 * Platform Adoption scoring engine.
 *
 * Computes three org-level scores and per-user engagement scores:
 *
 *   Adoption Score (0–100)    — % of users active in the last 7 days
 *   Engagement Score (0–100)  — average per-user composite engagement
 *   Feature Adoption (0–100)  — average feature adoption % across tracked features
 *
 * Per-user composite score breakdown (100 pts total):
 *   Login frequency     30pts   login_days_14d / 14 × 30
 *   Feature breadth     25pts   unique_features_14d / 8 × 25  (capped at 8 features)
 *   Action completion   25pts   actions_14d / 5 × 25          (capped at 5)
 *   Session depth       20pts   avg_session_min ≥ 5 → 20, linear below
 *
 * Champion threshold:  score > 75 AND login_days_7d ≥ 5 AND actions_14d ≥ 3
 * At-risk threshold:   score < 30 OR days_since_login ≥ 7
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";
import type {
  UserAdoptionMetrics,
  UserEngagementScore,
  AdoptionScore,
  EngagementScore,
  FeatureAdoptionScore,
  FeatureAdoptionEntry,
  ChampionUser,
  AtRiskUser,
  PlatformAdoptionAnalytics,
} from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAMPION_MIN_SCORE       = 75;
const CHAMPION_MIN_LOGIN_DAYS  = 5;   // out of 7
const CHAMPION_MIN_ACTIONS     = 3;   // in last 14d
const AT_RISK_MAX_SCORE        = 30;
const AT_RISK_MIN_DAYS_AWAY    = 7;

// ── Per-user score computation ────────────────────────────────────────────────

function computeEngagementScore(m: UserAdoptionMetrics): number {
  // Login frequency: up to 30 pts
  const loginScore = Math.min(m.loginDays14d / 14, 1) * 30;

  // Feature breadth: up to 25 pts (8 unique features = full score)
  const featureScore = Math.min(m.uniqueFeatures14d / 8, 1) * 25;

  // Action completion: up to 25 pts (5 actions = full score)
  const actionScore = Math.min(m.actionsCompleted14d / 5, 1) * 25;

  // Session depth: up to 20 pts (5-minute avg = full score)
  const avgSessionMin = m.avgSessionSeconds / 60;
  const sessionScore  = Math.min(avgSessionMin / 5, 1) * 20;

  const total = loginScore + featureScore + actionScore + sessionScore;
  return Math.round(Math.min(total, 100));
}

function deriveStatus(
  score:          number,
  daysSinceLogin: number | null,
  loginDays7d:    number,
  actions14d:     number,
): UserEngagementScore["status"] {
  if (
    score >= CHAMPION_MIN_SCORE &&
    loginDays7d >= CHAMPION_MIN_LOGIN_DAYS &&
    actions14d  >= CHAMPION_MIN_ACTIONS
  ) return "champion";

  if (score >= 60) return "active";
  if (score >= 30) return "occasional";

  if (daysSinceLogin !== null && daysSinceLogin >= AT_RISK_MIN_DAYS_AWAY) return "inactive";
  return "at_risk";
}

function buildAtRiskReasons(m: UserAdoptionMetrics, score: number): string[] {
  const reasons: string[] = [];

  if (m.daysSinceLogin !== null && m.daysSinceLogin >= 14) {
    reasons.push(`No login in ${m.daysSinceLogin} days`);
  } else if (m.daysSinceLogin !== null && m.daysSinceLogin >= 7) {
    reasons.push(`Inactive for ${m.daysSinceLogin} days`);
  }

  if (m.loginDays14d <= 1) {
    reasons.push("Only 1 login in the last 14 days");
  }

  if (m.uniqueFeatures14d <= 1) {
    reasons.push("Using only 1 feature");
  }

  if (m.actionsCompleted14d === 0) {
    reasons.push("No actions completed");
  }

  if (m.avgSessionSeconds < 60 && m.sessionCount14d > 0) {
    reasons.push("Very short sessions (< 1 min avg)");
  }

  if (reasons.length === 0) {
    reasons.push(`Low engagement score (${score}/100)`);
  }

  return reasons;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

interface RawUserRow {
  user_id:              string;
  org_id:               string | null;
  login_days_30d:       number;
  login_days_14d:       number;
  login_days_7d:        number;
  last_login_at:        string | null;
  time_since_login:     string | null;   // interval string from Postgres
  unique_features_14d:  number;
  session_count_14d:    number;
  avg_session_seconds:  number;
  page_views_14d:       number;
  unique_pages_14d:     number;
  sync_uses_14d:        number;
}

interface ProfileRow {
  id:        string;
  email:     string;
  full_name: string | null;
}

interface ActionCountRow {
  actioned_by: string;
  action_count: number;
}

interface AlertAckRow {
  acknowledged_by: string;
  ack_count: number;
}

async function fetchUserMetrics(): Promise<Map<string, RawUserRow>> {
  const db = getServiceRoleClient();
  const { data, error } = await (db as any)
    .from("v_user_adoption_summary")
    .select("*");

  if (error) throw new Error(`v_user_adoption_summary: ${error.message}`);

  const map = new Map<string, RawUserRow>();
  for (const row of data ?? []) {
    map.set(row.user_id, row as RawUserRow);
  }
  return map;
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  if (error) throw new Error(`profiles: ${error.message}`);

  const map = new Map<string, ProfileRow>();
  for (const row of (data ?? []) as ProfileRow[]) {
    map.set(row.id, row);
  }
  return map;
}

async function fetchActionCounts(): Promise<Map<string, number>> {
  const db = getServiceRoleClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // action_events.resolved_at indicates completion
  const { data, error } = await (db as any)
    .from("action_events")
    .select("actioned_by, count:id.count()")
    .not("actioned_by", "is", null)
    .gte("created_at", since);

  if (error) {
    logger.warn("adoption.fetchActionCounts: query failed", { error: error.message });
    return new Map();
  }

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as { actioned_by: string; count: string };
    map.set(r.actioned_by, parseInt(r.count, 10) || 0);
  }
  return map;
}

async function fetchAlertAckCounts(): Promise<Map<string, number>> {
  const db = getServiceRoleClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // manager_alerts: acknowledged_by / acknowledged_at
  const { data, error } = await (db as any)
    .from("manager_alerts")
    .select("acknowledged_by, count:id.count()")
    .not("acknowledged_at", "is", null)
    .not("acknowledged_by", "is", null)
    .gte("acknowledged_at", since);

  if (error) {
    logger.warn("adoption.fetchAlertAckCounts: query failed (manager_alerts may not have acknowledged_by)", {
      error: error.message,
    });
    return new Map();
  }

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as { acknowledged_by: string; count: string };
    map.set(r.acknowledged_by, parseInt(r.count, 10) || 0);
  }
  return map;
}

async function fetchFeatureAdoption(): Promise<FeatureAdoptionEntry[]> {
  const db = getServiceRoleClient();
  const { data, error } = await (db as any)
    .from("v_feature_adoption")
    .select("*");

  if (error) throw new Error(`v_feature_adoption: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    featureName:       row.feature_name,
    usersCount:        row.users_count,
    totalActiveUsers:  row.total_active_users,
    adoptionPct:       Number(row.adoption_pct),
    totalEvents:       row.total_events,
  }));
}

async function fetchTotalUsers(): Promise<number> {
  const db = getServiceRoleClient();
  const { count, error } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (error) {
    logger.warn("adoption.fetchTotalUsers: query failed", { error: error.message });
    return 0;
  }
  return count ?? 0;
}

/** Parse a Postgres interval string like "7 days 03:00:00" into fractional days. */
function parseIntervalToDays(interval: string | null): number | null {
  if (!interval) return null;
  // Postgres can return intervals like "3 days 04:00:00" or "1 day" or "2:30:00"
  const dayMatch = interval.match(/(\d+)\s+day/);
  const timeMatch = interval.match(/(\d+):(\d+):(\d+)/);

  let totalSeconds = 0;
  if (dayMatch)  totalSeconds += parseInt(dayMatch[1], 10) * 86400;
  if (timeMatch) {
    totalSeconds += parseInt(timeMatch[1], 10) * 3600;
    totalSeconds += parseInt(timeMatch[2], 10) * 60;
    totalSeconds += parseInt(timeMatch[3], 10);
  }
  return Math.round(totalSeconds / 86400);
}

// ── First-login-today check ───────────────────────────────────────────────────

async function fetchFirstLoginTodaySet(): Promise<Set<string>> {
  const db = getServiceRoleClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await db
    .from("platform_usage_events")
    .select("user_id, occurred_at")
    .eq("event_type", "login")
    .gte("occurred_at", today.toISOString())
    .order("occurred_at", { ascending: true });

  if (error) {
    logger.warn("adoption.fetchFirstLoginTodaySet: query failed", { error: error.message });
    return new Set();
  }

  // The first user_id encountered is the first login of today
  const seen = new Set<string>();
  const firstLoginSet = new Set<string>();

  for (const row of (data ?? []) as { user_id: string; occurred_at: string }[]) {
    if (!seen.has(row.user_id)) {
      seen.add(row.user_id);
      // The very first user_id (first row chronologically) gets the flag
      if (seen.size === 1) {
        firstLoginSet.add(row.user_id);
      }
    }
  }

  return firstLoginSet;
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function computePlatformAnalytics(): Promise<PlatformAdoptionAnalytics> {
  // Parallel data fetching
  const [
    userMetricsMap,
    actionCounts,
    alertAckCounts,
    featureAdoptionRaw,
    totalUsers,
    firstLoginTodaySet,
  ] = await Promise.all([
    fetchUserMetrics(),
    fetchActionCounts(),
    fetchAlertAckCounts(),
    fetchFeatureAdoption(),
    fetchTotalUsers(),
    fetchFirstLoginTodaySet(),
  ]);

  const userIds      = Array.from(userMetricsMap.keys());
  const profilesMap  = await fetchProfiles(userIds);

  // ── Build per-user scores ────────────────────────────────────────────────

  const userEngagement: UserEngagementScore[] = [];

  for (const [userId, raw] of Array.from(userMetricsMap.entries())) {
    const profile      = profilesMap.get(userId);
    const actions14d   = actionCounts.get(userId)  ?? 0;
    const alertAcks14d = alertAckCounts.get(userId) ?? 0;
    const daysSince    = parseIntervalToDays(raw.time_since_login);

    const metrics: UserAdoptionMetrics = {
      userId,
      orgId:               raw.org_id,
      loginDays30d:        raw.login_days_30d,
      loginDays14d:        raw.login_days_14d,
      loginDays7d:         raw.login_days_7d,
      lastLoginAt:         raw.last_login_at,
      daysSinceLogin:      daysSince,
      uniqueFeatures14d:   raw.unique_features_14d,
      sessionCount14d:     raw.session_count_14d,
      avgSessionSeconds:   raw.avg_session_seconds,
      pageViews14d:        raw.page_views_14d,
      uniquePages14d:      raw.unique_pages_14d,
      syncUses14d:         raw.sync_uses_14d,
      actionsCompleted14d: actions14d,
      alertAcks14d:        alertAcks14d,
    };

    const score = computeEngagementScore(metrics);
    const status = deriveStatus(score, daysSince, raw.login_days_7d, actions14d);

    const loginFrequency   = Math.round(Math.min(raw.login_days_14d / 14, 1) * 30);
    const featureBreadth   = Math.round(Math.min(raw.unique_features_14d / 8, 1) * 25);
    const actionCompletion = Math.round(Math.min(actions14d / 5, 1) * 25);
    const sessionDepth     = Math.round(Math.min((raw.avg_session_seconds / 60) / 5, 1) * 20);

    userEngagement.push({
      userId,
      email:       profile?.email    ?? userId,
      fullName:    profile?.full_name ?? null,
      score,
      status,
      components: { loginFrequency, featureBreadth, actionCompletion, sessionDepth },
      metrics,
      lastLoginAt:    raw.last_login_at,
      daysSinceLogin: daysSince,
    });
  }

  // ── Adoption Score ────────────────────────────────────────────────────────

  const activeUsers7d = userEngagement.filter((u) => u.metrics.loginDays7d > 0).length;
  const adoptionScore: AdoptionScore = {
    score:         totalUsers > 0 ? Math.round((activeUsers7d / totalUsers) * 100) : 0,
    activeUsers7d,
    totalUsers,
    trend:         0,  // TODO: compare to previous 7d window when we have enough history
  };

  // ── Engagement Score ──────────────────────────────────────────────────────

  const activeUsers = userEngagement.filter((u) => u.metrics.loginDays14d > 0);
  const avgEngagement =
    activeUsers.length > 0
      ? Math.round(activeUsers.reduce((sum, u) => sum + u.score, 0) / activeUsers.length)
      : 0;
  const engagementScore: EngagementScore = { score: avgEngagement, trend: 0 };

  // ── Feature Adoption Score ────────────────────────────────────────────────

  const avgFeatureAdoption =
    featureAdoptionRaw.length > 0
      ? Math.round(
          featureAdoptionRaw.reduce((sum, f) => sum + f.adoptionPct, 0) / featureAdoptionRaw.length,
        )
      : 0;
  const featureAdoption: FeatureAdoptionScore = {
    score:     avgFeatureAdoption,
    byFeature: featureAdoptionRaw,
  };

  // ── Champions ─────────────────────────────────────────────────────────────

  const champions: ChampionUser[] = userEngagement
    .filter(
      (u) =>
        u.status === "champion" ||
        (u.score >= CHAMPION_MIN_SCORE &&
          u.metrics.loginDays7d >= CHAMPION_MIN_LOGIN_DAYS - 1 &&
          u.metrics.actionsCompleted14d >= CHAMPION_MIN_ACTIONS),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((u) => ({
      userId:              u.userId,
      email:               u.email,
      fullName:            u.fullName,
      score:               u.score,
      loginDays7d:         u.metrics.loginDays7d,
      actionsCompleted14d: u.metrics.actionsCompleted14d,
      uniqueFeatures14d:   u.metrics.uniqueFeatures14d,
      avgSessionMinutes:   Math.round(u.metrics.avgSessionSeconds / 60),
      firstLoginToday:     firstLoginTodaySet.has(u.userId),
      lastLoginAt:         u.lastLoginAt,
    }));

  // ── At-Risk Users ─────────────────────────────────────────────────────────

  const atRiskUsers: AtRiskUser[] = userEngagement
    .filter(
      (u) =>
        u.status === "at_risk" ||
        u.status === "inactive" ||
        (u.metrics.daysSinceLogin !== null && u.metrics.daysSinceLogin >= AT_RISK_MIN_DAYS_AWAY),
    )
    .sort((a, b) => {
      // Sort by days since login descending, then by score ascending
      const daysA = a.metrics.daysSinceLogin ?? 999;
      const daysB = b.metrics.daysSinceLogin ?? 999;
      if (daysA !== daysB) return daysB - daysA;
      return a.score - b.score;
    })
    .slice(0, 10)
    .map((u) => ({
      userId:         u.userId,
      email:          u.email,
      fullName:       u.fullName,
      score:          u.score,
      daysSinceLogin: u.metrics.daysSinceLogin,
      riskReasons:    buildAtRiskReasons(u.metrics, u.score),
      lastLoginAt:    u.lastLoginAt,
    }));

  // ── Sort users by score descending for table ──────────────────────────────

  userEngagement.sort((a, b) => b.score - a.score);

  return {
    adoptionScore,
    engagementScore,
    featureAdoption,
    champions,
    atRiskUsers,
    userEngagement,
    computedAt: new Date().toISOString(),
  };
}
