import { describe, expect, it } from "vitest";
import { apiError, apiSuccess, compatError, compatSuccess } from "@/lib/api/response";

describe("API response contract", () => {
  it("builds the standard success envelope", () => {
    const response = apiSuccess(
      { ok: true },
      { requestId: "req_123", durationMs: 12, source: "contract-test" },
    );

    expect(response).toEqual({
      data: { ok: true },
      error: null,
      meta: {
        requestId: "req_123",
        durationMs: 12,
        source: "contract-test",
      },
    });
  });

  it("builds the standard error envelope without exposing raw error strings", () => {
    const response = apiError(
      "FORBIDDEN",
      "Forbidden",
      { source: "contract-test" },
      { reason: "role" },
    );

    expect(response).toEqual({
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Forbidden",
        details: { reason: "role" },
      },
      meta: { source: "contract-test" },
    });
  });

  it("adds envelopes to legacy payloads without changing legacy fields", () => {
    const legacy = { stores: [], accountability: [], actions: [], opsTrend: [] };
    const response = compatSuccess(legacy, legacy, { source: "head-office-summary" });

    expect(response.stores).toEqual([]);
    expect(response.accountability).toEqual([]);
    expect(response.actions).toEqual([]);
    expect(response.opsTrend).toEqual([]);
    expect(response.envelope).toEqual({
      data: legacy,
      error: null,
      meta: { source: "head-office-summary" },
    });
  });

  it("adds typed errors to legacy error payloads", () => {
    const response = compatError(
      { error: "Unauthorized" },
      "UNAUTHORIZED",
      "Unauthorized",
      { source: "cron-zombie-sync-cleanup" },
    );

    expect(response.error).toBe("Unauthorized");
    expect(response.envelope).toEqual({
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
      meta: { source: "cron-zombie-sync-cleanup" },
    });
  });
});
