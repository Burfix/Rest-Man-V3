/**
 * lib/adoption/client-tracker.ts
 *
 * React hook for client-side adoption event tracking.
 * Sends events to POST /api/admin/adoption/events from the browser.
 *
 * Usage (in any client component):
 *   const { trackPageView, trackFeatureUse, trackSyncUse } = useAdoptionTracker();
 *   trackFeatureUse("labour");    // fire-and-forget
 *
 * Session lifecycle is managed automatically — this hook opens a session
 * on mount and closes it (with duration) on unmount / page unload.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { resolveFeatureFromPath, type UsageEventPayload } from "./types";

// ── Internal helpers ──────────────────────────────────────────────────────────

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function postEvent(payload: UsageEventPayload): Promise<void> {
  try {
    await fetch("/api/admin/adoption/events", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      // keepalive allows the request to outlive the page
      keepalive: true,
    });
  } catch {
    // Silently swallow — tracking must never break the UX
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface AdoptionTracker {
  /** Manually track a feature interaction beyond page navigation. */
  trackFeatureUse:  (featureName: string, metadata?: Record<string, unknown>) => void;
  /** Manually track a sync action. */
  trackSyncUse:     (metadata?: Record<string, unknown>) => void;
}

/**
 * Mount once at the layout level to track:
 *  - Page views on every navigation
 *  - Session open on first render, close on unmount
 *
 * Returns helpers for manual tracking.
 */
export function useAdoptionTracker(): AdoptionTracker {
  const pathname        = usePathname();
  const sessionIdRef    = useRef<string>(generateSessionId());
  const pageCountRef    = useRef<number>(0);
  const eventCountRef   = useRef<number>(0);
  const sessionStartRef = useRef<number>(Date.now());

  // ── Track page view on every navigation ─────────────────────────────────
  useEffect(() => {
    pageCountRef.current  += 1;
    eventCountRef.current += 1;

    const featureName = resolveFeatureFromPath(pathname);

    postEvent({
      eventType:   "page_view",
      pagePath:    pathname,
      featureName: featureName ?? undefined,
      sessionId:   sessionIdRef.current,
    });

    // If this is a trackable feature page, also fire a feature_use event
    if (featureName) {
      eventCountRef.current += 1;
      postEvent({
        eventType:   "feature_use",
        featureName: featureName,
        pagePath:    pathname,
        sessionId:   sessionIdRef.current,
      });
    }
  }, [pathname]);

  // ── Session open on mount, close on unmount ──────────────────────────────
  useEffect(() => {
    sessionStartRef.current = Date.now();

    // Fire login event (idempotent by design — backend deduplicates per day)
    postEvent({
      eventType: "login",
      sessionId: sessionIdRef.current,
    });

    // Close the session when the component unmounts (or the page unloads)
    const handleUnload = () => {
      const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
      postEvent({
        eventType:       "session_end",
        durationSeconds: durationSeconds,
        sessionId:       sessionIdRef.current,
        metadata: {
          page_count:  pageCountRef.current,
          event_count: eventCountRef.current,
        },
      });
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      handleUnload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Manual trackers ──────────────────────────────────────────────────────

  const trackFeatureUse = useCallback(
    (featureName: string, metadata?: Record<string, unknown>) => {
      eventCountRef.current += 1;
      postEvent({
        eventType:   "feature_use",
        featureName: featureName,
        pagePath:    pathname,
        sessionId:   sessionIdRef.current,
        metadata,
      });
    },
    [pathname],
  );

  const trackSyncUse = useCallback(
    (metadata?: Record<string, unknown>) => {
      eventCountRef.current += 1;
      postEvent({
        eventType:  "sync_use",
        pagePath:   pathname,
        sessionId:  sessionIdRef.current,
        metadata,
      });
    },
    [pathname],
  );

  return { trackFeatureUse, trackSyncUse };
}
