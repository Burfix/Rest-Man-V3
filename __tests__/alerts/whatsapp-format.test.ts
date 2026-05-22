import { describe, it, expect } from "vitest";
import { formatAlertMessage, parseAckReply } from "@/lib/whatsapp/format";

describe("formatAlertMessage", () => {
  const base = {
    siteName:  "Test Site",
    severity:  "critical" as const,
    title:     "Labour over threshold",
    message:   "Labour cost at 45%, threshold is 38%.",
    alertId:   "abc12345-0000-0000-0000-000000000000",
  };

  it("includes all required sections", () => {
    const text = formatAlertMessage(base);
    expect(text).toContain("[ForgeStack Alert]");
    expect(text).toContain("Test Site");
    expect(text).toContain("Critical");
    expect(text).toContain("Labour over threshold");
    expect(text).toContain("Labour cost at 45%");
    expect(text).toContain("ACK-abc12345");
  });

  it("does not exceed 1600 characters", () => {
    const long = formatAlertMessage({ ...base, message: "x".repeat(2000) });
    expect(long.length).toBeLessThanOrEqual(1600);
  });
});

describe("parseAckReply", () => {
  it("parses ACK-{id} uppercase", () => {
    const r = parseAckReply("ACK-a1b2c3d4");
    expect(r.isAck).toBe(true);
    expect(r.shortId).toBe("a1b2c3d4");
  });

  it("parses lowercase ack {id}", () => {
    const r = parseAckReply("ack a1b2c3d4");
    expect(r.isAck).toBe(true);
    expect(r.shortId).toBe("a1b2c3d4");
  });

  it("parses bare ACK (no id)", () => {
    const r = parseAckReply("ACK");
    expect(r.isAck).toBe(true);
    expect(r.shortId).toBeNull();
  });

  it("returns isAck=false for non-ACK messages", () => {
    const r = parseAckReply("Hi, what time do you close?");
    expect(r.isAck).toBe(false);
  });
});
