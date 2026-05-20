/**
 * services/reviews/reviewIntelligence.ts
 *
 * ══ Guest Reviews Intelligence Engine ══
 *
 * Pure business logic for:
 *   - Classifying sentiment + urgency from review content
 *   - Generating category tags from review text
 *   - Creating review_actions for operational issues
 *   - Aggregating review_insights for a site+period
 *   - Generating suggested response drafts
 *
 * Single source of truth — used by all /api/reviews/* routes.
 * No DB calls — returns data for caller to persist.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewSource =
  | "google"
  | "booking_com"
  | "tripadvisor"
  | "airbnb"
  | "manual";

export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed";
export type ReviewUrgency = "low" | "medium" | "high" | "critical";
export type ReviewStatus =
  | "new"
  | "reviewed"
  | "action_required"
  | "responded"
  | "closed";
export type ReviewDepartment =
  | "housekeeping"
  | "front_desk"
  | "maintenance"
  | "management"
  | "reservations";
export type ActionPriority = "low" | "medium" | "high" | "critical";

export type CategoryTag =
  | "cleanliness"
  | "service"
  | "location"
  | "breakfast"
  | "noise"
  | "value"
  | "maintenance"
  | "staff"
  | "check_in"
  | "amenities"
  | "sea_view"
  | "parking"
  | "pool"
  | "safety";

export interface ReviewAnalysis {
  sentimentLabel: SentimentLabel;
  sentimentScore: number; // -1.0 to +1.0
  categoryTags: CategoryTag[];
  urgency: ReviewUrgency;
  suggestedActions: Array<{
    title: string;
    description: string;
    department: ReviewDepartment;
    priority: ActionPriority;
    dueDays: number; // days from now
  }>;
}

export interface ReviewInsightData {
  averageRating: number;
  totalReviews: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  topPositiveThemes: string[];
  topNegativeThemes: string[];
  operationalRisks: Array<{ tag: string; count: number; severity: string }>;
  recommendedActions: string[];
}

// ── Keyword maps ──────────────────────────────────────────────────────────────

const NEGATIVE_KEYWORDS: Record<string, CategoryTag[]> = {
  dirty:        ["cleanliness"],
  filthy:       ["cleanliness"],
  stain:        ["cleanliness"],
  mould:        ["cleanliness", "maintenance"],
  mold:         ["cleanliness", "maintenance"],
  smell:        ["cleanliness"],
  smells:       ["cleanliness"],
  odour:        ["cleanliness"],
  odor:         ["cleanliness"],
  cockroach:    ["cleanliness", "safety"],
  bug:          ["cleanliness"],
  broken:       ["maintenance"],
  leaking:      ["maintenance"],
  leak:         ["maintenance"],
  aircon:       ["maintenance", "amenities"],
  "air con":    ["maintenance", "amenities"],
  "air conditioning": ["maintenance", "amenities"],
  plumbing:     ["maintenance"],
  toilet:       ["maintenance"],
  shower:       ["maintenance"],
  "hot water":  ["maintenance"],
  loud:         ["noise"],
  noisy:        ["noise"],
  noise:        ["noise"],
  rude:         ["staff", "service"],
  unfriendly:   ["staff", "service"],
  unhelpful:    ["staff", "service"],
  ignored:      ["service"],
  slow:         ["service"],
  wait:         ["service"],
  "check-in":   ["check_in"],
  checkin:      ["check_in"],
  "check in":   ["check_in"],
  queue:        ["check_in"],
  overpriced:   ["value"],
  expensive:    ["value"],
  refund:       ["value", "service"],
  scam:         ["value", "safety"],
  theft:        ["safety"],
  stolen:       ["safety"],
  unsafe:       ["safety"],
  complaint:    ["service"],
};

const POSITIVE_KEYWORDS: Record<string, CategoryTag[]> = {
  clean:        ["cleanliness"],
  spotless:     ["cleanliness"],
  beautiful:    ["location", "sea_view"],
  stunning:     ["location", "sea_view"],
  "sea view":   ["sea_view"],
  ocean:        ["sea_view"],
  view:         ["sea_view"],
  location:     ["location"],
  friendly:     ["staff", "service"],
  helpful:      ["staff", "service"],
  professional: ["staff", "service"],
  amazing:      ["service"],
  excellent:    ["service"],
  breakfast:    ["breakfast"],
  pool:         ["pool"],
  parking:      ["parking"],
  value:        ["value"],
  "worth it":   ["value"],
};

const CRITICAL_KEYWORDS = new Set([
  "mould", "mold", "cockroach", "bug", "theft", "stolen",
  "unsafe", "scam", "refund", "complaint",
]);

// ── Core analysis ─────────────────────────────────────────────────────────────

/**
 * Analyse a review text + rating to produce structured intelligence.
 * Pure function — no side effects.
 */
export function analyseReview(
  reviewText: string,
  rating: number,
  ratingScale = 5,
): ReviewAnalysis {
  const lower = (reviewText ?? "").toLowerCase();
  const normRating = rating / ratingScale; // 0–1

  // ── Category tags ──────────────────────────────────────────────────────────
  const tagSet = new Set<CategoryTag>();
  let negHits = 0;
  let posHits = 0;
  let hasCriticalKeyword = false;

  for (const [kw, tags] of Object.entries(NEGATIVE_KEYWORDS)) {
    if (lower.includes(kw)) {
      tags.forEach((t) => tagSet.add(t));
      negHits++;
      if (CRITICAL_KEYWORDS.has(kw)) hasCriticalKeyword = true;
    }
  }
  for (const [kw, tags] of Object.entries(POSITIVE_KEYWORDS)) {
    if (lower.includes(kw)) {
      tags.forEach((t) => tagSet.add(t));
      posHits++;
    }
  }

  // ── Sentiment ──────────────────────────────────────────────────────────────
  let sentimentLabel: SentimentLabel;
  let sentimentScore: number;

  if (normRating >= 0.8 && negHits === 0) {
    sentimentLabel = "positive";
    sentimentScore = 0.6 + normRating * 0.4;
  } else if (normRating <= 0.4 && posHits === 0) {
    sentimentLabel = "negative";
    sentimentScore = -(0.6 + (1 - normRating) * 0.4);
  } else if (posHits > 0 && negHits > 0) {
    sentimentLabel = "mixed";
    sentimentScore = (normRating - 0.5) * 0.8;
  } else if (normRating >= 0.6) {
    sentimentLabel = "positive";
    sentimentScore = (normRating - 0.5) * 1.2;
  } else if (normRating <= 0.4) {
    sentimentLabel = "negative";
    sentimentScore = -(0.5 - normRating) * 1.2;
  } else {
    sentimentLabel = "neutral";
    sentimentScore = 0;
  }

  sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

  // ── Urgency ────────────────────────────────────────────────────────────────
  let urgency: ReviewUrgency;
  if (hasCriticalKeyword || (normRating <= 0.4 && rating <= 2)) {
    urgency = "critical";
  } else if (normRating <= 0.4 || negHits >= 3) {
    urgency = "high";
  } else if (normRating <= 0.6 || negHits >= 1) {
    urgency = "medium";
  } else {
    urgency = "low";
  }

  // ── Suggested actions ──────────────────────────────────────────────────────
  const suggestedActions: ReviewAnalysis["suggestedActions"] = [];

  if (tagSet.has("cleanliness")) {
    suggestedActions.push({
      title:       "Housekeeping audit required",
      description: `Guest mentioned cleanliness issue. Inspect and deep-clean affected areas. Source: review.`,
      department:  "housekeeping",
      priority:    urgency === "critical" ? "critical" : "high",
      dueDays:     1,
    });
  }

  if (tagSet.has("maintenance")) {
    suggestedActions.push({
      title:       "Maintenance inspection required",
      description: `Guest reported a maintenance issue (aircon / plumbing / broken item). Inspect and log repair.`,
      department:  "maintenance",
      priority:    urgency === "critical" ? "critical" : "high",
      dueDays:     1,
    });
  }

  if (tagSet.has("staff") || tagSet.has("service")) {
    const isAttitude = lower.includes("rude") || lower.includes("unfriendly") || lower.includes("attitude");
    suggestedActions.push({
      title:       isAttitude ? "Staff conduct review" : "Service quality review",
      description: `Guest flagged ${isAttitude ? "staff attitude" : "service quality"}. Review with team lead.`,
      department:  isAttitude ? "management" : "front_desk",
      priority:    normRating <= 0.4 ? "high" : "medium",
      dueDays:     2,
    });
  }

  if (tagSet.has("safety")) {
    suggestedActions.push({
      title:       "Safety or security incident flagged",
      description: `Guest mentioned safety / theft concern. Escalate to management immediately.`,
      department:  "management",
      priority:    "critical",
      dueDays:     0,
    });
  }

  if (normRating <= 0.4 && suggestedActions.length === 0) {
    suggestedActions.push({
      title:       "Respond to negative review",
      description: `Negative review (rating ${rating}/${ratingScale}) requires a prompt, professional response.`,
      department:  "management",
      priority:    "high",
      dueDays:     1,
    });
  }

  return {
    sentimentLabel,
    sentimentScore: Math.round(sentimentScore * 1000) / 1000,
    categoryTags: Array.from(tagSet),
    urgency,
    suggestedActions,
  };
}

// ── Insight aggregation ───────────────────────────────────────────────────────

interface ReviewRow {
  rating: number;
  sentiment_label?: string | null;
  category_tags?: string[] | null;
  urgency?: string | null;
}

/**
 * Aggregate a batch of review rows into a ReviewInsightData summary.
 */
export function aggregateInsights(reviews: ReviewRow[]): ReviewInsightData {
  if (reviews.length === 0) {
    return {
      averageRating: 0,
      totalReviews:  0,
      positiveCount: 0,
      neutralCount:  0,
      negativeCount: 0,
      topPositiveThemes: [],
      topNegativeThemes: [],
      operationalRisks:  [],
      recommendedActions: [],
    };
  }

  const totalReviews  = reviews.length;
  const averageRating = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / totalReviews) * 100) / 100;
  const positiveCount = reviews.filter((r) => r.sentiment_label === "positive").length;
  const neutralCount  = reviews.filter((r) => r.sentiment_label === "neutral").length;
  const negativeCount = reviews.filter((r) => r.sentiment_label === "negative" || r.sentiment_label === "mixed").length;

  // Tag frequency
  const posTagCounts: Record<string, number> = {};
  const negTagCounts: Record<string, number> = {};

  for (const r of reviews) {
    const tags = (r.category_tags ?? []) as string[];
    const isNeg = r.sentiment_label === "negative" || r.sentiment_label === "mixed" || r.rating < 3.5;
    for (const tag of tags) {
      if (isNeg) negTagCounts[tag] = (negTagCounts[tag] ?? 0) + 1;
      else       posTagCounts[tag] = (posTagCounts[tag] ?? 0) + 1;
    }
  }

  const topPositiveThemes = Object.entries(posTagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag]) => tag);

  const topNegativeThemes = Object.entries(negTagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag]) => tag);

  const operationalRisks = Object.entries(negTagCounts)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([tag, count]) => ({
      tag,
      count,
      severity: count >= 5 ? "critical" : count >= 3 ? "high" : "medium",
    }));

  // Recommended actions from risk themes
  const recommendedActions: string[] = [];
  if (negTagCounts["cleanliness"] >= 2) {
    recommendedActions.push("Schedule deep-clean audit — cleanliness mentioned in multiple reviews");
  }
  if (negTagCounts["maintenance"] >= 2) {
    recommendedActions.push("Conduct maintenance walkthrough — equipment/plumbing issues flagged");
  }
  if (negTagCounts["staff"] >= 2 || negTagCounts["service"] >= 2) {
    recommendedActions.push("Host team service briefing — staff/service issues mentioned");
  }
  if (averageRating < 4.0) {
    recommendedActions.push("Priority: rating below 4.0 — implement recovery action plan");
  } else if (averageRating < 4.2) {
    recommendedActions.push("Monitor rating closely — below 4.2 threshold");
  }
  if (negativeCount > reviews.length * 0.3) {
    recommendedActions.push("High negative review volume — escalate to Head Office");
  }

  return {
    averageRating,
    totalReviews,
    positiveCount,
    neutralCount,
    negativeCount,
    topPositiveThemes,
    topNegativeThemes,
    operationalRisks,
    recommendedActions,
  };
}

// ── Response draft generator ──────────────────────────────────────────────────

/**
 * Generate a professional hotel response draft for a given review.
 * Returns plain text — no auto-posting.
 */
export function generateResponseDraft(opts: {
  guestName?: string | null;
  rating: number;
  ratingScale: number;
  reviewText: string;
  sentimentLabel?: SentimentLabel | null;
  propertyName?: string;
}): string {
  const { guestName, rating, ratingScale, reviewText, sentimentLabel, propertyName = "Sea Castle Hotel Camps Bay" } = opts;
  const lower = reviewText.toLowerCase();
  const normRating = rating / ratingScale;
  const salutation = guestName ? `Dear ${guestName}` : "Dear Valued Guest";

  if (normRating >= 0.8 && sentimentLabel === "positive") {
    return `${salutation},\n\nThank you so much for your wonderful review and for choosing ${propertyName}. We are delighted to hear that you enjoyed your stay with us. Your kind words mean the world to our team and inspire us to continue delivering an exceptional guest experience.\n\nWe truly hope to welcome you back to ${propertyName} very soon.\n\nWarm regards,\nThe ${propertyName} Team`;
  }

  if (normRating <= 0.4 || sentimentLabel === "negative") {
    const hasCleanliness = lower.includes("dirty") || lower.includes("clean") || lower.includes("mould");
    const hasMaintenance = lower.includes("broken") || lower.includes("aircon") || lower.includes("leaking");
    const hasStaff       = lower.includes("rude") || lower.includes("unfriendly");

    let specificResponse = "";
    if (hasCleanliness) {
      specificResponse = "We take cleanliness extremely seriously and your feedback has been immediately shared with our housekeeping team for urgent review. ";
    } else if (hasMaintenance) {
      specificResponse = "We apologise for the maintenance inconvenience you experienced. Our facilities team has been notified and will address this without delay. ";
    } else if (hasStaff) {
      specificResponse = "We are sorry to hear about your interaction with our team. This falls well below the standard of service we hold ourselves to, and the matter will be addressed with our management team. ";
    }

    return `${salutation},\n\nThank you for taking the time to share your feedback. We sincerely apologise that your recent stay at ${propertyName} did not meet your expectations. ${specificResponse}We would welcome the opportunity to understand your experience further and make things right. Please feel free to contact us directly at reservations@seacastlehotelcampsbay.co.za so we can assist you personally.\n\nWe hope you will give us the opportunity to restore your confidence in us.\n\nSincerely,\nThe ${propertyName} Management Team`;
  }

  // Mixed / neutral
  return `${salutation},\n\nThank you for sharing your experience at ${propertyName}. We are glad there were aspects of your stay that you enjoyed, and we appreciate your honest feedback on areas where we can do better. Your comments have been shared with our team to help us continually improve.\n\nWe hope to have the pleasure of welcoming you back and exceeding your expectations on your next visit.\n\nKind regards,\nThe ${propertyName} Team`;
}

// ── Alert signal helpers ──────────────────────────────────────────────────────

/**
 * Evaluate whether a batch of recent reviews creates operating score signals.
 * Returns a risk level and driver messages for the operating score.
 */
export function evaluateReviewRisk(avgRating: number, negativeCount7d: number, unresolvedNegOlderThan48h: number): {
  riskLevel: "none" | "medium" | "high" | "critical";
  drivers: string[];
} {
  const drivers: string[] = [];
  let riskLevel: "none" | "medium" | "high" | "critical" = "none";

  if (avgRating < 4.0) {
    drivers.push(`Average guest rating ${avgRating.toFixed(1)} — below acceptable threshold`);
    riskLevel = "high";
  } else if (avgRating < 4.2) {
    drivers.push(`Average guest rating ${avgRating.toFixed(1)} — approaching risk threshold`);
    riskLevel = "medium";
  }

  if (negativeCount7d >= 3) {
    drivers.push(`${negativeCount7d} negative reviews in last 7 days — critical trend`);
    riskLevel = "critical";
  }

  if (unresolvedNegOlderThan48h > 0) {
    drivers.push(`${unresolvedNegOlderThan48h} unresponded negative review${unresolvedNegOlderThan48h > 1 ? "s" : ""} older than 48h`);
    if (riskLevel !== "critical") riskLevel = "high";
  }

  return { riskLevel, drivers };
}
