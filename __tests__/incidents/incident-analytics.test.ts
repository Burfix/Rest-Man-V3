/**
 * __tests__/incidents/incident-analytics.test.ts
 *
 * Pure unit tests for lib/incidents/analytics.ts
 *
 * No mocks needed — all functions are deterministic when given a fixed `now`.
 */

import { describe, it, expect } from "vitest";
import {
  computeSlaBreachTrend,
  computeMttrTrend,
  computeAckLatencyBySite,
  computeRepeatOffenders,
  computeAgingBuckets,
  computeOperatorWorkload,
  computeEscalationTrend,
  computeWeeklySummary,
  type IncidentForAnalytics,
} from "@/lib/incidents/analytics";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// T0 = Monday 2024-01-15 10:00 UTC
const T0 = new Date("2024-01-15T10:00:00.000Z").getTime();

function ms(minutes: number): number {
  return minutes * 60_000;
}

function daysMs(d: number): number {
  return d * 86_400_000;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function makeIncident(
  overrides: Partial<IncidentForAnalytics> & Pick<IncidentForAnalytics, "id" | "createdAt">,
): IncidentForAnalytics {
  return {
    siteId:          "site-a",
    source:          "test-source",
    severity:        "warning",
    status:          "open",
    resolvedAt:      null,
    acknowledgedAt:  null,
    assignedTo:      null,
    escalationLevel: "normal",
    ...overrides,
  };
}

// ── computeSlaBreachTrend ─────────────────────────────────────────────────────

describe("computeSlaBreachTrend", () => {
  it("generates exactly `days` buckets, oldest first", () => {
    const result = computeSlaBreachTrend([], 7, T0);
    expect(result).toHaveLength(7);
    expect(result[0].date < result[6].date).toBe(true);
  });

  it("returns complianceRate=100 for buckets with no incidents", () => {
    const result = computeSlaBreachTrend([], 7, T0);
    expect(result.every(p => p.complianceRate === 100)).toBe(true);
  });

  it("counts ack breach correctly for open unacknowledged critical at 20min", () => {
    const now = T0 + ms(20); // 20 min after T0
    const inc = makeIncident({
      id:        "i1",
      severity:  "critical", // threshold: 15min ack
      createdAt: iso(T0),
      status:    "open",
    });
    const result = computeSlaBreachTrend([inc], 1, now);
    // Only 1 bucket (today). inc was created at T0 which is within the 1-day window.
    const today = result.find(p => p.date === iso(T0).slice(0, 10));
    expect(today?.ackBreached).toBe(1);
    expect(today?.uniqueBreached).toBe(1);
    expect(today?.complianceRate).toBe(0); // 1 incident, 1 breached
  });

  it("does not count breach for critical acknowledged at 10min (under threshold)", () => {
    const now = T0 + ms(20);
    const inc = makeIncident({
      id:            "i2",
      severity:      "critical",
      createdAt:     iso(T0),
      status:        "acknowledged",
      acknowledgedAt: iso(T0 + ms(10)), // 10min — under 15min threshold
    });
    const result = computeSlaBreachTrend([inc], 1, now);
    const today  = result.find(p => p.date === iso(T0).slice(0, 10));
    expect(today?.ackBreached).toBe(0);
  });

  it("counts resolution breach for resolved incident over 4h (critical threshold)", () => {
    const now      = T0 + ms(500);
    const resolved = makeIncident({
      id:        "i3",
      severity:  "critical", // resolveMinutes = 240
      createdAt: iso(T0),
      status:    "resolved",
      resolvedAt: iso(T0 + ms(250)), // 250min > 240min
    });
    const result = computeSlaBreachTrend([resolved], 1, now);
    const today  = result.find(p => p.date === iso(T0).slice(0, 10));
    expect(today?.resolutionBreached).toBe(1);
  });

  it("excludes incidents older than the lookback window", () => {
    const inc = makeIncident({
      id:        "i4",
      createdAt: iso(T0 - daysMs(8)), // 8 days ago
    });
    const result = computeSlaBreachTrend([inc], 7, T0);
    expect(result.every(p => p.total === 0)).toBe(true);
  });
});

// ── computeMttrTrend ──────────────────────────────────────────────────────────

describe("computeMttrTrend", () => {
  it("returns empty array when no resolved incidents", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0), status: "open" });
    expect(computeMttrTrend([inc], 30, T0)).toHaveLength(0);
  });

  it("groups by resolution week and computes avg MTTR", () => {
    const inc1 = makeIncident({
      id:        "i1",
      createdAt:  iso(T0),
      status:    "resolved",
      resolvedAt: iso(T0 + ms(60)),  // MTTR = 60min
    });
    const inc2 = makeIncident({
      id:        "i2",
      createdAt:  iso(T0 + ms(30)),
      status:    "resolved",
      resolvedAt: iso(T0 + ms(150)), // MTTR = 120min
    });
    // Both resolve in same week as T0 (2024-01-15)
    const result = computeMttrTrend([inc1, inc2], 30, T0 + daysMs(7));
    expect(result).toHaveLength(1);
    expect(result[0].avgMttrMinutes).toBe(90); // avg of 60 and 120
    expect(result[0].resolvedCount).toBe(2);
  });

  it("places incidents in correct week bucket", () => {
    // inc1 resolved in week of Jan 15 (T0), inc2 resolved in week of Jan 22
    const inc1 = makeIncident({
      id:        "i1",
      createdAt:  iso(T0),
      status:    "resolved",
      resolvedAt: iso(T0 + ms(30)),
    });
    const inc2 = makeIncident({
      id:        "i2",
      createdAt:  iso(T0),
      status:    "resolved",
      resolvedAt: iso(T0 + daysMs(7) + ms(30)),
    });
    const result = computeMttrTrend([inc1, inc2], 30, T0 + daysMs(14));
    expect(result).toHaveLength(2);
    expect(result[0].weekStart).toBe("2024-01-15");
    expect(result[1].weekStart).toBe("2024-01-22");
  });
});

// ── computeAckLatencyBySite ───────────────────────────────────────────────────

describe("computeAckLatencyBySite", () => {
  it("returns empty array when no acked incidents", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0) });
    expect(computeAckLatencyBySite([inc], new Map())).toHaveLength(0);
  });

  it("skips incidents without siteId", () => {
    const inc = makeIncident({
      id:            "i1",
      createdAt:     iso(T0),
      acknowledgedAt: iso(T0 + ms(5)),
      siteId:        null,
    });
    expect(computeAckLatencyBySite([inc], new Map())).toHaveLength(0);
  });

  it("computes avg, p50, p90 correctly for a single site", () => {
    const siteId = "site-x";
    const times  = [10, 20, 30, 40, 50]; // minutes
    const incs   = times.map((t, idx) => makeIncident({
      id:            `i${idx}`,
      createdAt:     iso(T0),
      acknowledgedAt: iso(T0 + ms(t)),
      siteId,
    }));
    const result = computeAckLatencyBySite(incs, new Map([[siteId, "Site X"]]));
    expect(result).toHaveLength(1);
    const e = result[0];
    expect(e.siteName).toBe("Site X");
    expect(e.avgAckMinutes).toBe(30); // avg of [10,20,30,40,50]
    expect(e.p50AckMinutes).toBe(30); // median
    expect(e.p90AckMinutes).toBe(50); // 90th percentile of 5 items → index ceil(0.9*5)-1 = 3 → 40... 
    // Actually: ceil(0.9*5)=5, idx=4, sorted[4]=50
    expect(e.incidentCount).toBe(5);
  });
});

// ── computeRepeatOffenders ────────────────────────────────────────────────────

describe("computeRepeatOffenders", () => {
  it("returns empty when all sources appear only once", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), source: "alpha" }),
      makeIncident({ id: "i2", createdAt: iso(T0), source: "beta" }),
    ];
    expect(computeRepeatOffenders(incs)).toHaveLength(0);
  });

  it("identifies source with 3 fires as repeat offender", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0),               source: "noisy-integration" }),
      makeIncident({ id: "i2", createdAt: iso(T0 + ms(60)),      source: "noisy-integration" }),
      makeIncident({ id: "i3", createdAt: iso(T0 + ms(120)),     source: "noisy-integration" }),
    ];
    const result = computeRepeatOffenders(incs);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("noisy-integration");
    expect(result[0].incidentCount).toBe(3);
    expect(result[0].avgIntervalHours).toBe(1); // 60min = 1h
  });

  it("counts criticalCount correctly", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0),           source: "src", severity: "critical" }),
      makeIncident({ id: "i2", createdAt: iso(T0 + ms(30)),  source: "src", severity: "warning" }),
      makeIncident({ id: "i3", createdAt: iso(T0 + ms(60)),  source: "src", severity: "critical" }),
    ];
    const result = computeRepeatOffenders(incs);
    expect(result[0].criticalCount).toBe(2);
  });

  it("sorts by incident count descending", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0),          source: "b" }),
      makeIncident({ id: "i2", createdAt: iso(T0 + ms(10)), source: "b" }),
      makeIncident({ id: "i3", createdAt: iso(T0),          source: "a" }),
      makeIncident({ id: "i4", createdAt: iso(T0 + ms(10)), source: "a" }),
      makeIncident({ id: "i5", createdAt: iso(T0 + ms(20)), source: "a" }),
    ];
    const result = computeRepeatOffenders(incs);
    expect(result[0].source).toBe("a");
    expect(result[1].source).toBe("b");
  });
});

// ── computeAgingBuckets ───────────────────────────────────────────────────────

describe("computeAgingBuckets", () => {
  it("returns 5 buckets (always)", () => {
    expect(computeAgingBuckets([], T0)).toHaveLength(5);
  });

  it("places incident aged 30min in < 1 hour bucket", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0) });
    const result = computeAgingBuckets([inc], T0 + ms(30));
    expect(result[0].total).toBe(1);   // < 1 hour
    expect(result[1].total).toBe(0);   // 1-4h
  });

  it("places incident aged 5h in 4-8h bucket", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0) });
    const result = computeAgingBuckets([inc], T0 + ms(300));
    expect(result[2].total).toBe(1);   // 4-8h
  });

  it("places incident aged 25h in > 24h bucket", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0) });
    const result = computeAgingBuckets([inc], T0 + ms(1500));
    expect(result[4].total).toBe(1);   // > 24h
  });

  it("does not include resolved incidents", () => {
    const inc = makeIncident({
      id:        "i1",
      createdAt:  iso(T0),
      status:    "resolved",
      resolvedAt: iso(T0 + ms(30)),
    });
    const result = computeAgingBuckets([inc], T0 + ms(30));
    expect(result.every(b => b.total === 0)).toBe(true);
  });

  it("groups by severity correctly", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), severity: "critical" }),
      makeIncident({ id: "i2", createdAt: iso(T0), severity: "warning" }),
      makeIncident({ id: "i3", createdAt: iso(T0), severity: "info" }),
    ];
    const result = computeAgingBuckets(incs, T0 + ms(30));
    expect(result[0].critical).toBe(1);
    expect(result[0].warning).toBe(1);
    expect(result[0].info).toBe(1);
    expect(result[0].total).toBe(3);
  });
});

// ── computeOperatorWorkload ───────────────────────────────────────────────────

describe("computeOperatorWorkload", () => {
  it("returns empty array when no incidents have assignedTo", () => {
    const inc = makeIncident({ id: "i1", createdAt: iso(T0) });
    expect(computeOperatorWorkload([inc])).toHaveLength(0);
  });

  it("groups correctly and computes open/resolved counts", () => {
    const uid = "op-uuid-001";
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), status: "open",     assignedTo: uid }),
      makeIncident({ id: "i2", createdAt: iso(T0), status: "resolved", assignedTo: uid, resolvedAt: iso(T0 + ms(60)) }),
      makeIncident({ id: "i3", createdAt: iso(T0), status: "resolved", assignedTo: uid, resolvedAt: iso(T0 + ms(120)) }),
    ];
    const result = computeOperatorWorkload(incs);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(uid);
    expect(result[0].openCount).toBe(1);
    expect(result[0].resolvedCount).toBe(2);
    expect(result[0].avgMttrMinutes).toBe(90); // avg(60,120)
  });

  it("counts escalated incidents correctly", () => {
    const uid = "op-uuid-002";
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), assignedTo: uid, escalationLevel: "elevated" }),
      makeIncident({ id: "i2", createdAt: iso(T0), assignedTo: uid, escalationLevel: "urgent" }),
      makeIncident({ id: "i3", createdAt: iso(T0), assignedTo: uid, escalationLevel: "normal" }),
    ];
    const result = computeOperatorWorkload(incs);
    expect(result[0].escalatedCount).toBe(2);
  });
});

// ── computeEscalationTrend ────────────────────────────────────────────────────

describe("computeEscalationTrend", () => {
  it("generates exactly `days` buckets", () => {
    expect(computeEscalationTrend([], 14, T0)).toHaveLength(14);
  });

  it("buckets incidents by creation date and escalation level", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), escalationLevel: "elevated" }),
      makeIncident({ id: "i2", createdAt: iso(T0), escalationLevel: "urgent" }),
      makeIncident({ id: "i3", createdAt: iso(T0), escalationLevel: "normal" }),
    ];
    const result = computeEscalationTrend(incs, 1, T0 + ms(30));
    const today  = result.find(p => p.date === iso(T0).slice(0, 10));
    expect(today?.normalCount).toBe(1);
    expect(today?.elevatedCount).toBe(1);
    expect(today?.urgentCount).toBe(1);
  });
});

// ── computeWeeklySummary ──────────────────────────────────────────────────────

describe("computeWeeklySummary", () => {
  it("returns 100% compliance and no incidents when array is empty", () => {
    const result = computeWeeklySummary([], new Map(), T0);
    expect(result.totalIncidents).toBe(0);
    expect(result.slaComplianceRate).toBe(100);
    expect(result.worstSite).toBeNull();
    expect(result.worstSource).toBeNull();
  });

  it("filters to last 7 days only", () => {
    const old = makeIncident({ id: "i1", createdAt: iso(T0 - daysMs(8)) });
    const recent = makeIncident({ id: "i2", createdAt: iso(T0 - daysMs(2)) });
    const result = computeWeeklySummary([old, recent], new Map(), T0);
    expect(result.totalIncidents).toBe(1);
  });

  it("identifies worst site correctly", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0 - daysMs(1)), siteId: "site-a" }),
      makeIncident({ id: "i2", createdAt: iso(T0 - daysMs(1)), siteId: "site-b" }),
      makeIncident({ id: "i3", createdAt: iso(T0 - daysMs(1)), siteId: "site-b" }),
    ];
    const result = computeWeeklySummary(incs, new Map([["site-b", "Site B"]]), T0);
    expect(result.worstSite?.siteId).toBe("site-b");
    expect(result.worstSite?.siteName).toBe("Site B");
    expect(result.worstSite?.incidentCount).toBe(2);
  });

  it("computes SLA compliance rate correctly", () => {
    // 4 incidents, 1 breached (critical open for > 4h)
    const now = T0 + ms(300); // 300min after T0
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0), severity: "critical", status: "open" }), // resolution breached at 300min > 240min
      makeIncident({ id: "i2", createdAt: iso(T0), severity: "info",     status: "resolved", resolvedAt: iso(T0 + ms(60)) }),
      makeIncident({ id: "i3", createdAt: iso(T0), severity: "info",     status: "resolved", resolvedAt: iso(T0 + ms(60)) }),
      makeIncident({ id: "i4", createdAt: iso(T0), severity: "info",     status: "resolved", resolvedAt: iso(T0 + ms(60)) }),
    ];
    const result = computeWeeklySummary(incs, new Map(), now);
    // 1 uniqueBreached out of 4: compliance = 3/4 = 75%
    expect(result.slaComplianceRate).toBe(75);
  });

  it("computes avgMttrMinutes correctly from resolved incidents", () => {
    const incs = [
      makeIncident({ id: "i1", createdAt: iso(T0 - daysMs(1)), status: "resolved", resolvedAt: iso(T0 - daysMs(1) + ms(60)) }),
      makeIncident({ id: "i2", createdAt: iso(T0 - daysMs(1)), status: "resolved", resolvedAt: iso(T0 - daysMs(1) + ms(120)) }),
    ];
    const result = computeWeeklySummary(incs, new Map(), T0);
    expect(result.avgMttrMinutes).toBe(90);
    expect(result.resolvedCount).toBe(2);
  });
});
