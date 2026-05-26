/**
 * __tests__/incidents/incident-sla.test.ts
 *
 * Pure unit tests for lib/incidents/sla.ts
 *
 * No mocks required — all functions are pure and deterministic when
 * provided with a fixed `now` parameter.
 */

import { describe, it, expect } from "vitest";
import {
  calculateIncidentAge,
  calculateTimeToAcknowledge,
  calculateTimeToResolve,
  isAckBreached,
  isResolutionBreached,
  getEscalationRecommendation,
  getIncidentSlaState,
} from "@/lib/incidents/sla";

// ── Helpers ───────────────────────────────────────────────────────────────────

const T0 = new Date("2024-01-15T10:00:00.000Z").getTime();

function minsAfterT0(minutes: number): string {
  return new Date(T0 + minutes * 60_000).toISOString();
}

function openIncident(severity: "critical" | "warning" | "info") {
  return {
    severity,
    status:         "open",
    createdAt:      new Date(T0).toISOString(),
    resolvedAt:     null,
    acknowledgedAt: null,
    escalationLevel: "normal" as const,
  };
}

// ── calculateIncidentAge ──────────────────────────────────────────────────────

describe("calculateIncidentAge", () => {
  it("returns 0 for incident created exactly at now", () => {
    const age = calculateIncidentAge({ createdAt: new Date(T0).toISOString() }, T0);
    expect(age).toBe(0);
  });

  it("returns 60 for incident created 60 minutes ago", () => {
    const createdAt = new Date(T0).toISOString();
    const now       = T0 + 60 * 60_000;
    expect(calculateIncidentAge({ createdAt }, now)).toBeCloseTo(60, 5);
  });
});

// ── calculateTimeToAcknowledge ────────────────────────────────────────────────

describe("calculateTimeToAcknowledge", () => {
  it("returns null when incident has no acknowledgedAt", () => {
    expect(calculateTimeToAcknowledge({ createdAt: new Date(T0).toISOString(), acknowledgedAt: null })).toBeNull();
  });

  it("returns 5.0 when acknowledged exactly 5 minutes later", () => {
    const result = calculateTimeToAcknowledge({
      createdAt:      new Date(T0).toISOString(),
      acknowledgedAt: minsAfterT0(5),
    });
    expect(result).toBeCloseTo(5, 5);
  });
});

// ── calculateTimeToResolve ────────────────────────────────────────────────────

describe("calculateTimeToResolve", () => {
  it("returns null when incident is unresolved", () => {
    expect(calculateTimeToResolve({ createdAt: new Date(T0).toISOString(), resolvedAt: null })).toBeNull();
  });

  it("returns 60.0 when resolved exactly 60 minutes later", () => {
    const result = calculateTimeToResolve({
      createdAt:  new Date(T0).toISOString(),
      resolvedAt: minsAfterT0(60),
    });
    expect(result).toBeCloseTo(60, 5);
  });
});

// ── isAckBreached ─────────────────────────────────────────────────────────────

describe("isAckBreached", () => {
  it("critical open at 16min → breached (threshold 15min)", () => {
    const inc = openIncident("critical");
    expect(isAckBreached(inc, T0 + 16 * 60_000)).toBe(true);
  });

  it("critical open at 14min → NOT breached (under 15min threshold)", () => {
    const inc = openIncident("critical");
    expect(isAckBreached(inc, T0 + 14 * 60_000)).toBe(false);
  });

  it("warning open at 31min → breached (threshold 30min)", () => {
    const inc = openIncident("warning");
    expect(isAckBreached(inc, T0 + 31 * 60_000)).toBe(true);
  });

  it("info open at 121min → breached (threshold 120min)", () => {
    const inc = openIncident("info");
    expect(isAckBreached(inc, T0 + 121 * 60_000)).toBe(true);
  });

  it("resolved incident is never ack-breached", () => {
    const inc = {
      ...openIncident("critical"),
      status:     "resolved",
      resolvedAt: minsAfterT0(30),
    };
    expect(isAckBreached(inc, T0 + 60 * 60_000)).toBe(false);
  });

  it("acknowledged incident is never ack-breached", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(5),
    };
    expect(isAckBreached(inc, T0 + 60 * 60_000)).toBe(false);
  });
});

// ── isResolutionBreached ──────────────────────────────────────────────────────

describe("isResolutionBreached", () => {
  it("critical: acknowledged at 10min, now 250min → NOT breached (under 240min)", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(10),
    };
    expect(isResolutionBreached(inc, T0 + 250 * 60_000)).toBe(false);
  });

  it("critical: acknowledged at 10min, now 251min → breached (241min since ack, over 240min limit)", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(10),
    };
    // 251 - 10 = 241 min since ack > 240 min SLA threshold → breached
    expect(isResolutionBreached(inc, T0 + 251 * 60_000)).toBe(true);
  });

  it("resolved incident is never resolution-breached", () => {
    const inc = {
      ...openIncident("critical"),
      status:     "resolved",
      resolvedAt: minsAfterT0(10),
    };
    expect(isResolutionBreached(inc, T0 + 500 * 60_000)).toBe(false);
  });
});

// ── getEscalationRecommendation ───────────────────────────────────────────────

describe("getEscalationRecommendation", () => {
  it("returns 'normal' for critical incident well within thresholds (5min)", () => {
    const inc = openIncident("critical");
    expect(getEscalationRecommendation(inc, T0 + 5 * 60_000)).toBe("normal");
  });

  it("returns 'elevated' when ack is breached (critical, 16min)", () => {
    const inc = openIncident("critical");
    expect(getEscalationRecommendation(inc, T0 + 16 * 60_000)).toBe("elevated");
  });

  it("returns 'elevated' when age ≥ 50% of resolveMinutes (critical: 120min of 240)", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(5),
    };
    // 120 min = exactly 50% of 240
    expect(getEscalationRecommendation(inc, T0 + 120 * 60_000)).toBe("elevated");
  });

  it("returns 'urgent' when age ≥ 90% of resolveMinutes (critical: 216min of 240)", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(5),
    };
    // 216 min = exactly 90% of 240
    expect(getEscalationRecommendation(inc, T0 + 216 * 60_000)).toBe("urgent");
  });

  it("returns 'normal' for resolved incidents regardless of age", () => {
    const inc = {
      ...openIncident("critical"),
      status:     "resolved",
      resolvedAt: minsAfterT0(30),
    };
    expect(getEscalationRecommendation(inc, T0 + 500 * 60_000)).toBe("normal");
  });
});

// ── getIncidentSlaState ───────────────────────────────────────────────────────

describe("getIncidentSlaState", () => {
  it("resolved incident returns slaStatus='resolved', ackBreached=false, resolutionBreached=false", () => {
    const inc = {
      severity:       "critical" as const,
      status:         "resolved",
      createdAt:      new Date(T0).toISOString(),
      resolvedAt:     minsAfterT0(60),
      acknowledgedAt: null,
      escalationLevel: "normal" as const,
    };
    const state = getIncidentSlaState(inc, T0 + 120 * 60_000);
    expect(state.slaStatus).toBe("resolved");
    expect(state.ackBreached).toBe(false);
    expect(state.resolutionBreached).toBe(false);
    expect(state.mttrMinutes).toBeCloseTo(60, 5);
  });

  it("open critical at 20min: slaStatus='ack_breached', recommendedEscalation='elevated'", () => {
    const inc = openIncident("critical");
    const state = getIncidentSlaState(inc, T0 + 20 * 60_000);
    expect(state.slaStatus).toBe("ack_breached");
    expect(state.ackBreached).toBe(true);
    expect(state.recommendedEscalation).toBe("elevated");
    expect(state.timeToAckMinutes).toBeNull();
  });

  it("open critical at 250min: slaStatus='resolution_breached', recommendedEscalation='urgent'", () => {
    const inc = openIncident("critical");
    const state = getIncidentSlaState(inc, T0 + 250 * 60_000);
    expect(state.slaStatus).toBe("resolution_breached");
    expect(state.resolutionBreached).toBe(true);
    expect(state.recommendedEscalation).toBe("urgent");
  });

  it("within-SLA critical acknowledged at 5min, at 10min total age", () => {
    const inc = {
      ...openIncident("critical"),
      status:         "acknowledged",
      acknowledgedAt: minsAfterT0(5),
    };
    const state = getIncidentSlaState(inc, T0 + 10 * 60_000);
    expect(state.slaStatus).toBe("within_sla");
    expect(state.ackBreached).toBe(false);
    expect(state.resolutionBreached).toBe(false);
    expect(state.timeToAckMinutes).toBeCloseTo(5, 5);
    expect(state.recommendedEscalation).toBe("normal");
  });
});
