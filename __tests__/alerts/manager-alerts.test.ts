/**
 * Unit tests for manager-alert-service business logic.
 *
 * Heavy DB and WhatsApp calls are mocked so tests run in isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase service-role client
// ---------------------------------------------------------------------------
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from: mockFrom }),
}));

// ---------------------------------------------------------------------------
// Mock WhatsApp provider
// ---------------------------------------------------------------------------
const mockSendText = vi.fn();
vi.mock("@/lib/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ sendTextMessage: mockSendText, isConfigured: () => true }),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { createManagerAlert } from "@/services/alerts/manager-alert-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockInsertChain(returnValue: object) {
  const select = vi.fn().mockResolvedValue({ data: [returnValue], error: null });
  const single = vi.fn().mockResolvedValue({ data: returnValue, error: null });
  const insertMock = { select: () => ({ single }) };
  mockFrom.mockReturnValue({ insert: () => insertMock });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("createManagerAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a row and returns the alert", async () => {
    const fakeAlert = {
      id:         "alert-uuid",
      site_id:    "site-uuid",
      manager_id: "mgr-uuid",
      alert_type: "labour",
      severity:   "warning",
      source:     "manual",
      title:      "Labour over budget",
      message:    "Details here.",
      status:     "pending",
      retry_count: 0,
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    };

    const single = vi.fn().mockResolvedValue({ data: fakeAlert, error: null });
    mockFrom.mockReturnValue({
      insert: () => ({ select: () => ({ single }) }),
    });

    const result = await createManagerAlert({
      site_id:    "site-uuid",
      manager_id: "mgr-uuid",
      alert_type: "labour",
      severity:   "warning",
      source:     "manual",
      title:      "Labour over budget",
      message:    "Details here.",
      created_by: "user-uuid",
    });

    expect(result.id).toBe("alert-uuid");
    expect(result.status).toBe("pending");
  });

  it("throws if DB returns an error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    mockFrom.mockReturnValue({
      insert: () => ({ select: () => ({ single }) }),
    });

    await expect(
      createManagerAlert({
        site_id:    "site-uuid",
        manager_id: "mgr-uuid",
        alert_type: "labour",
        severity:   "warning",
        source:     "manual",
        title:      "Test",
        message:    "Test message",
        created_by: "user-uuid",
      })
    ).rejects.toThrow("DB error");
  });
});
