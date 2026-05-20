/**
 * lib/audit/logger.ts
 *
 * Structured operational audit logger — writes to the `audit_logs` table
 * (migration 079). Separate from the legacy `audit_log` table used for
 * access/role events.
 *
 * Design rules:
 *   - NEVER throw — audit failures must not break the calling operation.
 *   - Fire-and-forget-safe: callers should `await` it but wrapping in
 *     `.catch(() => {})` is fine for non-critical paths.
 *   - No PII: strip passwords, tokens, emails from JSONB payloads.
 *   - Payload cap: truncate any string field > 10 KB.
 *   - site_id is MANDATORY — every event must be scoped.
 *
 * Usage:
 *   import { auditLog, auditScoreCalculation, auditJobTransition } from "@/lib/audit/logger";
 *   await auditLog({ ... });
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActorType = "system" | "user" | "scheduler" | "api";

export interface AuditLogEntry {
  /** MANDATORY — no global/org-level audit logs allowed */
  siteId:       string;
  actorType:    ActorType;
  /** userId, 'score-calculator', 'worker-<id>', etc. */
  actorId?:     string;
  /** Dot-namespaced action: 'score.calculated', 'job.transitioned', etc. */
  action:       string;
  /** Affected entity category: 'manager_score', 'sync_job', 'schedule', etc. */
  entityType:   string;
  /** UUID or composite key of the affected record */
  entityId?:    string;
  /** State snapshot BEFORE the change (null for creates) */
  beforeState?: Record<string, unknown>;
  /** State snapshot AFTER the change (null for deletes) */
  afterState?:  Record<string, unknown>;
  /** Extra context: attempts, error, module source, etc. */
  metadata?:    Record<string, unknown>;
  /** Caller IP — for user-initiated events only */
  ipAddress?:   string;
  /** Browser UA — for user-initiated events only */
  userAgent?:   string;
  /** Trace token linking multiple related audit entries */
  requestId?:   string;
}

// ── Sanitization ──────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password", "token", "secret", "key", "auth", "credential",
  "access_token", "refresh_token", "api_key", "bearer",
]);

const MAX_STRING_BYTES = 10_000;

function sanitize(obj: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  try {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
      if (typeof v === "string") {
        // Truncate large strings
        cleaned[k] = v.length > MAX_STRING_BYTES ? v.slice(0, MAX_STRING_BYTES) + "…[truncated]" : v;
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        cleaned[k] = sanitize(v as Record<string, unknown>);
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return { _sanitize_error: "Failed to sanitize payload" };
  }
}

// ── Core writer ───────────────────────────────────────────────────────────────

/**
 * Write a single audit log entry to `audit_logs`.
 * Never throws — wraps the insert in try/catch.
 */
export async function auditLog(entry: AuditLogEntry): Promise<void> {
  if (!entry.siteId) {
    logger.warn("audit.log.missing_site_id", { action: entry.action, entityType: entry.entityType });
    return;
  }

  try {
    const supabase = createServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("audit_logs").insert({
      site_id:      entry.siteId,
      actor_type:   entry.actorType,
      actor_id:     entry.actorId     ?? null,
      action:       entry.action,
      entity_type:  entry.entityType,
      entity_id:    entry.entityId    ?? null,
      before_state: sanitize(entry.beforeState),
      after_state:  sanitize(entry.afterState),
      metadata:     sanitize(entry.metadata),
      ip_address:   entry.ipAddress   ?? null,
      user_agent:   entry.userAgent   ?? null,
      request_id:   entry.requestId   ?? null,
    });

    if (error) {
      logger.warn("audit.log.insert_failed", {
        action:      entry.action,
        site_id:     entry.siteId,
        error:       error.message,
      });
    }
  } catch (err) {
    // Audit failures must never crash the calling operation.
    logger.warn("audit.log.exception", {
      action:  entry.action,
      site_id: entry.siteId,
      err:     String(err),
    });
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Log a score calculation result (after `calculateDailyScores` upsert).
 * Records before/after per (user_id, site_id, date).
 */
export async function auditScoreCalculation(params: {
  siteId:       string;
  userId:       string;
  periodDate:   string;
  beforeScore?: number | null;
  afterScore:   number;
  metrics: {
    tasksAssigned:    number;
    tasksCompleted:   number;
    tasksOnTime:      number;
    tasksBlocked:     number;
    tasksEscalated:   number;
    completionRate:   number;
    onTimeRate:       number;
  };
  actorId?: string;
}): Promise<void> {
  await auditLog({
    siteId:      params.siteId,
    actorType:   "system",
    actorId:     params.actorId ?? "score-calculator",
    action:      "score.calculated",
    entityType:  "manager_score",
    entityId:    `${params.userId}|${params.siteId}|${params.periodDate}`,
    beforeState: params.beforeScore != null
      ? { score: params.beforeScore }
      : undefined,
    afterState: {
      score:        params.afterScore,
      period_date:  params.periodDate,
    },
    metadata: {
      tasks_assigned:   params.metrics.tasksAssigned,
      tasks_completed:  params.metrics.tasksCompleted,
      tasks_on_time:    params.metrics.tasksOnTime,
      tasks_blocked:    params.metrics.tasksBlocked,
      tasks_escalated:  params.metrics.tasksEscalated,
      completion_rate:  params.metrics.completionRate,
      on_time_rate:     params.metrics.onTimeRate,
    },
  });
}

/**
 * Log a scheduler job state transition.
 * Called at: leased→running, running→success, running→failed, running→dead_letter.
 */
export async function auditJobTransition(params: {
  siteId:         string;
  jobId:          string;
  jobType:        string;
  fromStatus:     string;
  toStatus:       string;
  attempts:       number;
  errorMessage?:  string;
  traceId?:       string;
}): Promise<void> {
  await auditLog({
    siteId:     params.siteId,
    actorType:  "scheduler",
    actorId:    `worker`,
    action:     "job.transitioned",
    entityType: "sync_job",
    entityId:   params.jobId,
    beforeState: { status: params.fromStatus },
    afterState:  { status: params.toStatus },
    metadata: {
      job_type:      params.jobType,
      attempts:      params.attempts,
      error_message: params.errorMessage ?? null,
      trace_id:      params.traceId ?? null,
    },
  });
}

/**
 * Log a schedule configuration change (cadence, pause, resume).
 */
export async function auditScheduleChange(params: {
  siteId:       string;
  scheduleId:   string;
  syncType:     string;
  field:        string;
  oldValue:     string | number | boolean;
  newValue:     string | number | boolean;
  changedBy:    string;
}): Promise<void> {
  await auditLog({
    siteId:      params.siteId,
    actorType:   "user",
    actorId:     params.changedBy,
    action:      "schedule.changed",
    entityType:  "sync_schedule",
    entityId:    params.scheduleId,
    beforeState: { [params.field]: params.oldValue },
    afterState:  { [params.field]: params.newValue },
    metadata: {
      sync_type: params.syncType,
    },
  });
}

/**
 * Log a priority action generated by the Operating Brain.
 * Called when runOperatingBrain produces a non-fallback primary threat.
 */
export async function auditBrainAction(params: {
  siteId:            string;
  threatTitle:       string;
  threatSeverity:    string;
  modulesInvolved:   string[];
  moneyAtRisk:       number;
  recommendedAction: string;
  confidence:        string;
  systemHealthScore: number;
  systemHealthGrade: string;
}): Promise<void> {
  await auditLog({
    siteId:     params.siteId,
    actorType:  "system",
    actorId:    "operating-brain",
    action:     "brain.action_generated",
    entityType: "brain_output",
    entityId:   params.siteId,
    afterState: {
      threat_title:       params.threatTitle,
      threat_severity:    params.threatSeverity,
      system_health_score: params.systemHealthScore,
      system_health_grade: params.systemHealthGrade,
    },
    metadata: {
      modules_involved:   params.modulesInvolved,
      money_at_risk:      params.moneyAtRisk,
      recommended_action: params.recommendedAction,
      confidence:         params.confidence,
    },
  });
}
