/**
 * lib/adoption/types.ts
 *
 * Canonical TypeScript types for the Platform Adoption Analytics module.
 * Consumed by the scoring engine, API routes, and UI components.
 */

// ── Event types ───────────────────────────────────────────────────────────────

export type UsageEventType =
  | 'login'
  | 'page_view'
  | 'feature_use'
  | 'sync_use'
  | 'session_end';

/** All trackable features — mirrors key nav items in the platform. */
export const TRACKED_FEATURES = [
  'actions',
  'compliance',
  'labour',
  'profit',
  'forecast',
  'maintenance',
  'reviews',
  'daily-ops',
  'head-office',
  'alerts',
] as const;

export type TrackedFeature = (typeof TRACKED_FEATURES)[number];

/** Maps page path prefixes to feature names. Order matters — most specific first. */
export const PAGE_FEATURE_MAP: Record<string, TrackedFeature> = {
  '/dashboard/daily-ops':         'daily-ops',
  '/dashboard/compliance-engine': 'compliance',
  '/dashboard/compliance':        'compliance',
  '/dashboard/maintenance':       'maintenance',
  '/dashboard/forecast':          'forecast',
  '/dashboard/profit':            'profit',
  '/dashboard/labour':            'labour',
  '/dashboard/reviews':           'reviews',
  '/dashboard/head-office':       'head-office',
  '/dashboard/accountability':    'actions',
};

/** Resolve a page path to its feature name. Returns null if not a tracked feature. */
export function resolveFeatureFromPath(path: string): TrackedFeature | null {
  for (const [prefix, feature] of Object.entries(PAGE_FEATURE_MAP)) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return feature;
    }
  }
  return null;
}

// ── Raw event payload (sent from client to API) ───────────────────────────────

export interface UsageEventPayload {
  eventType:       UsageEventType;
  featureName?:    string;
  pagePath?:       string;
  durationSeconds?: number;
  sessionId?:      string;
  metadata?:       Record<string, unknown>;
}

// ── Per-user raw metrics (from v_user_adoption_summary) ───────────────────────

export interface UserAdoptionMetrics {
  userId:              string;
  orgId:               string | null;

  // Login frequency
  loginDays30d:        number;
  loginDays14d:        number;
  loginDays7d:         number;
  lastLoginAt:         string | null;   // ISO timestamp
  daysSinceLogin:      number | null;

  // Feature breadth
  uniqueFeatures14d:   number;

  // Session depth
  sessionCount14d:     number;
  avgSessionSeconds:   number;

  // Page engagement
  pageViews14d:        number;
  uniquePages14d:      number;

  // Integration usage
  syncUses14d:         number;

  // From action_events table
  actionsCompleted14d: number;

  // From manager_alerts table
  alertAcks14d:        number;
}

// ── Computed scores (0–100) ───────────────────────────────────────────────────

export interface UserEngagementScore {
  userId:              string;
  email:               string;
  fullName:            string | null;

  /** Overall engagement score 0–100 */
  score:               number;

  /** Component scores for transparency */
  components: {
    loginFrequency:    number;   // /30
    featureBreadth:    number;   // /25
    actionCompletion:  number;   // /25
    sessionDepth:      number;   // /20
  };

  /** Derived status */
  status:              'champion' | 'active' | 'occasional' | 'at_risk' | 'inactive';

  /** Raw metrics for display */
  metrics:             UserAdoptionMetrics;

  /** ISO timestamp */
  lastLoginAt:         string | null;
  daysSinceLogin:      number | null;
}

// ── Org-level aggregate scores ────────────────────────────────────────────────

export interface AdoptionScore {
  /** % of registered users active in last 7 days */
  score:               number;
  activeUsers7d:       number;
  totalUsers:          number;
  trend:               number;  // delta vs previous 7-day period
}

export interface EngagementScore {
  /** Average engagement score across all active users */
  score:               number;
  trend:               number;
}

export interface FeatureAdoptionScore {
  /** Average feature adoption % across all tracked features */
  score:               number;
  byFeature:           FeatureAdoptionEntry[];
}

export interface FeatureAdoptionEntry {
  featureName:         string;
  usersCount:          number;
  totalActiveUsers:    number;
  adoptionPct:         number;
  totalEvents:         number;
}

// ── Champion & At-Risk profiles ───────────────────────────────────────────────

export interface ChampionUser {
  userId:              string;
  email:               string;
  fullName:            string | null;
  score:               number;
  loginDays7d:         number;
  actionsCompleted14d: number;
  uniqueFeatures14d:   number;
  avgSessionMinutes:   number;
  /** Was this user the first login of today? */
  firstLoginToday:     boolean;
  lastLoginAt:         string | null;
}

export interface AtRiskUser {
  userId:              string;
  email:               string;
  fullName:            string | null;
  score:               number;
  daysSinceLogin:      number | null;
  riskReasons:         string[];
  lastLoginAt:         string | null;
}

// ── Full analytics response ───────────────────────────────────────────────────

export interface PlatformAdoptionAnalytics {
  adoptionScore:       AdoptionScore;
  engagementScore:     EngagementScore;
  featureAdoption:     FeatureAdoptionScore;
  champions:           ChampionUser[];
  atRiskUsers:         AtRiskUser[];
  userEngagement:      UserEngagementScore[];
  /** ISO timestamp of when this was computed */
  computedAt:          string;
}
