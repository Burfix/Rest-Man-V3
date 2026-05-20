import { describe, it, expect } from "vitest";
import {
  analyseReview,
  aggregateInsights,
  evaluateReviewRisk,
  generateResponseDraft,
} from "@/services/reviews/reviewIntelligence";

// ── analyseReview ─────────────────────────────────────────────────────────────

describe("analyseReview", () => {
  it("cleanliness keyword → housekeeping action", () => {
    const result = analyseReview("The room was dirty and stained", 2, 5);
    expect(result.categoryTags).toContain("cleanliness");
    const action = result.suggestedActions.find((a) => a.department === "housekeeping");
    expect(action).toBeDefined();
  });

  it("aircon keyword → maintenance action", () => {
    const result = analyseReview("The aircon was broken the whole stay", 2, 5);
    expect(result.categoryTags).toContain("maintenance");
    const action = result.suggestedActions.find((a) => a.department === "maintenance");
    expect(action).toBeDefined();
  });

  it("low rating (2/5) with critical keyword → critical urgency", () => {
    const result = analyseReview("Found mould in the bathroom. Terrible.", 2, 5);
    expect(result.urgency).toBe("critical");
  });

  it("low rating (2/5) no critical keyword → high urgency (or critical if normRating threshold met)", () => {
    const result = analyseReview("Very disappointed with the service.", 2, 5);
    // normRating 0.4 <= 0.4 && rating 2 <= 2 → engine marks critical
    expect(["critical", "high"]).toContain(result.urgency);
  });

  it("high rating with positive text → positive sentiment", () => {
    const result = analyseReview("Stunning sea view and beautiful location. Spotlessly clean.", 5, 5);
    expect(result.sentimentLabel).toBe("positive");
    expect(result.sentimentScore).toBeGreaterThan(0);
  });

  it("rude keyword → management action", () => {
    const result = analyseReview("The receptionist was rude and dismissive.", 2, 5);
    const action = result.suggestedActions.find((a) => a.department === "management");
    expect(action).toBeDefined();
  });

  it("positive review → no cleanliness or maintenance actions", () => {
    const result = analyseReview("Perfect stay. Amazing staff, beautiful view, excellent breakfast.", 5, 5);
    const badActions = result.suggestedActions.filter((a) =>
      a.department === "housekeeping" || a.department === "maintenance",
    );
    expect(badActions).toHaveLength(0);
  });

  it("returns category tags as array without duplicates", () => {
    const result = analyseReview("Dirty room with broken toilet and mould.", 1, 5);
    const unique = new Set(result.categoryTags);
    expect(result.categoryTags.length).toBe(unique.size);
  });

  it("10-scale rating normalises correctly — high rating positive", () => {
    const result = analyseReview("Great hotel, beautiful views and friendly staff.", 9, 10);
    expect(result.sentimentLabel).toBe("positive");
  });
});

// ── evaluateReviewRisk ────────────────────────────────────────────────────────

describe("evaluateReviewRisk", () => {
  it("avgRating < 4.0 → high risk", () => {
    const { riskLevel } = evaluateReviewRisk(3.8, 0, 0);
    expect(riskLevel).toBe("high");
  });

  it("avgRating between 4.0 and 4.2 → medium risk", () => {
    const { riskLevel } = evaluateReviewRisk(4.1, 0, 0);
    expect(riskLevel).toBe("medium");
  });

  it("negativeCount7d >= 3 → critical regardless of rating", () => {
    const { riskLevel } = evaluateReviewRisk(4.5, 3, 0);
    expect(riskLevel).toBe("critical");
  });

  it("unresolvedNegOlderThan48h > 0 → at least high risk", () => {
    const { riskLevel } = evaluateReviewRisk(4.5, 0, 1);
    expect(riskLevel).toBe("high");
  });

  it("good rating, no issues → no risk", () => {
    const { riskLevel } = evaluateReviewRisk(4.6, 0, 0);
    expect(riskLevel).toBe("none");
  });

  it("returns driver messages for each risk signal", () => {
    const { drivers } = evaluateReviewRisk(3.9, 4, 2);
    expect(drivers.length).toBeGreaterThanOrEqual(3);
  });
});

// ── generateResponseDraft ─────────────────────────────────────────────────────

describe("generateResponseDraft", () => {
  it("positive sentiment → contains thank you", () => {
    const draft = generateResponseDraft({
      guestName: "Sarah",
      rating: 5,
      ratingScale: 5,
      reviewText: "Wonderful stay, beautiful views.",
      sentimentLabel: "positive",
    });
    expect(draft.toLowerCase()).toContain("thank you");
  });

  it("negative + cleanliness keyword → housekeeping apology", () => {
    const draft = generateResponseDraft({
      guestName: "Mark",
      rating: 1,
      ratingScale: 5,
      reviewText: "The room was dirty and I found mould.",
      sentimentLabel: "negative",
    });
    expect(draft.toLowerCase()).toContain("housekeeping");
  });

  it("negative + rude keyword → staff conduct mention", () => {
    const draft = generateResponseDraft({
      guestName: "Anna",
      rating: 1,
      ratingScale: 5,
      reviewText: "The receptionist was rude and unhelpful.",
      sentimentLabel: "negative",
    });
    expect(draft.toLowerCase()).toContain("management");
  });

  it("includes guest name in salutation when provided", () => {
    const draft = generateResponseDraft({
      guestName: "Carlos",
      rating: 5,
      ratingScale: 5,
      reviewText: "Amazing location and great staff.",
      sentimentLabel: "positive",
    });
    expect(draft).toContain("Dear Carlos");
  });

  it("uses fallback salutation when no guest name", () => {
    const draft = generateResponseDraft({
      guestName: null,
      rating: 5,
      ratingScale: 5,
      reviewText: "Great experience.",
      sentimentLabel: "positive",
    });
    expect(draft).toContain("Dear Valued Guest");
  });
});

// ── aggregateInsights ─────────────────────────────────────────────────────────

describe("aggregateInsights", () => {
  it("empty array → zero values returned", () => {
    const result = aggregateInsights([]);
    expect(result.totalReviews).toBe(0);
    expect(result.averageRating).toBe(0);
    expect(result.positiveCount).toBe(0);
    expect(result.negativeCount).toBe(0);
  });

  it("single positive review → totals 1, no negatives", () => {
    const result = aggregateInsights([
      {
        rating: 5,
        sentiment_label: "positive",
      },
    ]);
    expect(result.totalReviews).toBe(1);
    expect(result.positiveCount).toBe(1);
    expect(result.negativeCount).toBe(0);
  });

  it("mixed reviews produce non-zero positive + negative counts", () => {
    const result = aggregateInsights([
      { rating: 5, sentiment_label: "positive" },
      { rating: 1, sentiment_label: "negative" },
      { rating: 3, sentiment_label: "neutral" },
    ]);
    expect(result.positiveCount).toBe(1);
    expect(result.negativeCount).toBe(1);
    expect(result.neutralCount).toBe(1);
  });

  it("averageRating computed correctly", () => {
    const result = aggregateInsights([
      { rating: 4, sentiment_label: "positive" },
      { rating: 2, sentiment_label: "negative" },
    ]);
    // avg of [4, 2] = 3
    expect(result.averageRating).toBe(3);
  });
});
