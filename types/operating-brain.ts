/**
 * types/operating-brain.ts — ForgeStack Operating Brain UI types
 *
 * Central type definitions for the redesigned command surface.
 * These types wire the existing backend data into the new UX layer.
 */

import type { ActionSeverity, ActionCategory, ImpactWeight, DashboardAction } from "@/lib/commandCenter";
import type { TrendSignal } from "@/lib/commandCenter";

// ── Command Feed ────────────────────────────────────────────────────────────

export interface CommandFeedItem {
  id:              string;
  severity:        ActionSeverity;
  category:        ActionCategory;
  title:           string;
  explanation:     string;
  action:          string;
  impact:          string;
  impactWeight?:   ImpactWeight;
  freshness:       "live" | "recent" | "stale";
  href:            string;
  serviceWindow?:  number; // minutes remaining
  recoveryMetric?: string;
}

/** Transform existing DashboardAction[] → CommandFeedItem[] */
export function toCommandFeedItems(actions: DashboardAction[]): CommandFeedItem[] {
  return actions.map((a, i) => ({
    id:              `action-${i}`,
    severity:        a.severity,
    category:        a.category,
    title:           a.title,
    explanation:     a.message,
    action:          a.recommendation,
    impact:          a.impactLabel ?? a.recoveryMetric ?? "",
    impactWeight:    a.impactWeight,
    freshness:       a.serviceWindowMinutes != null && a.serviceWindowMinutes < 60 ? "live" : "recent",
    href:            a.href,
    serviceWindow:   a.serviceWindowMinutes,
    recoveryMetric:  a.recoveryMetric,
  }));
}

// ── Today at a Glance ───────────────────────────────────────────────────────

export interface GlanceSummary {
  grade:           string;
  score:           number;
  riskLevel:       "low" | "moderate" | "elevated" | "critical";
  servicePeriod:   string;
  lastSync:        string;
  daySummary:      string;
}

// ── Business Status ─────────────────────────────────────────────────────────

export interface BusinessStatusItem {
  key:       string;
  label:     string;
  metric:    string;
  subtext:   string;
  tone:      "good" | "warning" | "danger" | "neutral";
  href:      string;
  trend?:    TrendSignal;
}

// ── Data Health ─────────────────────────────────────────────────────────────

export interface DataHealthStatus {
  overall:     "healthy" | "degraded" | "stale";
  salesSync:   { label: string; age: string; stale: boolean };
  labourSync:  { label: string; age: string; stale: boolean };
  systems:     Array<{ name: string; age: string; stale: boolean; href: string }>;
}
