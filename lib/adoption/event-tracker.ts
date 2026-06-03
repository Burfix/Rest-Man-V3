/**
 * lib/adoption/event-tracker.ts
 *
 * Server-side event logger for the Platform Adoption module.
 * Writes to platform_usage_events and user_sessions tables.
 *
 * Design rules:
 *   - NEVER throws — failures are logged but never propagate.
 *   - Fire-and-forget safe (callers can await or not).
 *   - No raw PII: IP is SHA-256 hashed before storage.
 *   - All writes go through service_role (bypasses RLS).
 *
 * Usage:
 *   import { trackEvent, openSession, closeSession } from "@/lib/adoption/event-tracker";
 *   await trackEvent({ userId, orgId, eventType: 'login' });
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";
import type { UsageEventType } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrackEventInput {
  userId:           string;
  orgId?:           string | null;
  siteId?:          string | null;
  eventType:        UsageEventType;
  featureName?:     string;
  pagePath?:        string;
  durationSeconds?: number;
  metadata?:        Record<string, unknown>;
  userAgent?:       string;
  /** Raw IP — will be SHA-256 hashed before storage. Never stored as-is. */
  rawIp?:           string;
}

export interface OpenSessionInput {
  userId:  string;
  orgId?:  string | null;
  siteId?: string | null;
}

// ── IP hashing ────────────────────────────────────────────────────────────────

async function hashIp(raw: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(raw + (process.env.IP_HASH_SALT ?? "forge-salt"));
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "unknown";
  }
}

// ── trackEvent ────────────────────────────────────────────────────────────────

/**
 * Write a single usage event to platform_usage_events.
 * Safe to call from any server-side context.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    const db = getServiceRoleClient();

    const ipHash = input.rawIp ? await hashIp(input.rawIp) : null;

    const { error } = await (db as any).from("platform_usage_events").insert({
      event_type:       input.eventType,
      user_id:          input.userId,
      org_id:           input.orgId   ?? null,
      site_id:          input.siteId  ?? null,
      feature_name:     input.featureName  ?? null,
      page_path:        input.pagePath     ?? null,
      duration_seconds: input.durationSeconds ?? null,
      metadata:         input.metadata ?? {},
      user_agent:       input.userAgent ?? null,
      ip_hash:          ipHash,
    });

    if (error) {
      logger.warn("adoption.trackEvent: DB insert failed", {
        userId:    input.userId,
        eventType: input.eventType,
        error:     error.message,
      });
    }
  } catch (err) {
    logger.error("adoption.trackEvent: unexpected error", {
      userId:    input.userId,
      eventType: input.eventType,
      err:       String(err),
    });
  }
}

// ── openSession ───────────────────────────────────────────────────────────────

/**
 * Create a new session record. Returns the session ID for later closure.
 * Returns null on failure (caller should handle gracefully).
 */
export async function openSession(input: OpenSessionInput): Promise<string | null> {
  try {
    const db = getServiceRoleClient();
    const { data, error } = await (db as any)
      .from("user_sessions")
      .insert({
        user_id: input.userId,
        org_id:  input.orgId  ?? null,
        site_id: input.siteId ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      logger.warn("adoption.openSession: failed", {
        userId: input.userId,
        error:  error?.message,
      });
      return null;
    }

    return (data as { id: string }).id;
  } catch (err) {
    logger.error("adoption.openSession: unexpected error", {
      userId: input.userId,
      err:    String(err),
    });
    return null;
  }
}

// ── closeSession ──────────────────────────────────────────────────────────────

/**
 * Mark a session as ended and update its page/event counts.
 */
export async function closeSession(
  sessionId:   string,
  pageCount:   number,
  eventCount:  number,
): Promise<void> {
  try {
    const db = getServiceRoleClient();
    const { error } = await (db as any)
      .from("user_sessions")
      .update({
        ended_at:    new Date().toISOString(),
        page_count:  pageCount,
        event_count: eventCount,
      })
      .eq("id", sessionId)
      .is("ended_at", null);   // only close unclosed sessions

    if (error) {
      logger.warn("adoption.closeSession: update failed", {
        sessionId,
        error: error.message,
      });
    }
  } catch (err) {
    logger.error("adoption.closeSession: unexpected error", {
      sessionId,
      err: String(err),
    });
  }
}
