/**
 * Reviews Integration Adapter
 *
 * Fetches reviews from Google Places (or other platforms),
 * validates, deduplicates by external_id, writes raw → canonical.
 *
 * Canonical target: reviews
 *
 * Google Places API key: GOOGLE_PLACES_API_KEY env var.
 * Place ID per store: stored in sites.settings.google_place_id
 */

import {
  BaseIntegrationAdapter,
  type AdapterConfig,
  type FetchResult,
  type ValidationResult,
} from "@/lib/integrations/base/adapter";
import { writeAuditLog } from "@/lib/audit/auditLog";

// ── Raw payload ────────────────────────────────────────────────────────────────

interface GoogleReviewRecord {
  review_id:       string;
  author_name:     string;
  rating:          number;              // 1–5
  text:            string | null;
  time:            number;              // unix timestamp
  relative_time:   string;
}

// ── Canonical form ─────────────────────────────────────────────────────────────

interface ReviewInsert {
  site_id:        string;
  platform:       string;
  external_id:    string;
  reviewer_name:  string;
  rating:         number;
  review_text:    string | null;
  review_date:    string;
  raw_record_id:  string;
}

// ── Adapter ────────────────────────────────────────────────────────────────────

export class ReviewsAdapter extends BaseIntegrationAdapter<GoogleReviewRecord, ReviewInsert> {
  private readonly apiKey: string;
  private placeId: string | null = null;

  constructor(config: AdapterConfig) {
    super({ ...config, sourceType: "reviews" });
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  }

  protected async authenticate(): Promise<void> {
    // Fetch site settings to get the Google Place ID
    const { data } = await this.db
      .from("sites")
      .select("settings")
      .eq("id", this.siteId)
      .single();

    const settings = (data?.settings ?? {}) as Record<string, unknown>;
    this.placeId   = typeof settings.google_place_id === "string"
      ? settings.google_place_id
      : null;
  }

  protected async fetch(): Promise<FetchResult<GoogleReviewRecord>> {
    if (!this.apiKey || !this.placeId) return { records: [] };

    const url = `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${this.placeId}&fields=reviews&key=${this.apiKey}&language=en`;

    const res  = await fetch(url);
    if (!res.ok) throw new Error(`[Reviews] Google API error: ${res.status}`);
    const json = await res.json();

    const reviews: GoogleReviewRecord[] = (json?.result?.reviews ?? []).map(
      (r: Record<string, unknown>) => ({
        review_id:     String(r.time),     // Google doesn't expose a stable ID; use timestamp
        author_name:   r.author_name,
        rating:        r.rating,
        text:          r.text ?? null,
        time:          r.time,
        relative_time: r.relative_time_description,
      })
    );
    return { records: reviews };
  }

  protected validate(record: GoogleReviewRecord): ValidationResult {
    const errors: string[] = [];
    if (!record.review_id)                     errors.push("Missing review_id");
    if (!record.author_name)                   errors.push("Missing author_name");
    if (typeof record.rating !== "number" ||
        record.rating < 1 || record.rating > 5) errors.push("rating must be 1–5");
    if (typeof record.time !== "number")       errors.push("time must be a unix timestamp");
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  protected extractSourceRecordId(record: GoogleReviewRecord): string {
    return `google:${this.siteId}:${record.review_id}`;
  }

  protected async persistRaw(
    record:          GoogleReviewRecord,
    sourceRecordId:  string,
    batchId:         string
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from("raw_reviews")
      .insert({
        site_id:           this.siteId,
        source_record_id:  sourceRecordId,
        source_platform:   "google",
        sync_batch_id:     batchId,
        source_payload:    record,
        validation_status: "valid",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") return null;
      throw error;
    }
    return data?.id ?? null;
  }

  protected transform(record: GoogleReviewRecord, rawId: string): ReviewInsert {
    return {
      site_id:       this.siteId,
      platform:      "google",
      external_id:   record.review_id,
      reviewer_name: record.author_name,
      rating:        record.rating,
      review_text:   record.text ?? null,
      review_date:   new Date(record.time * 1000).toISOString().slice(0, 10),
      raw_record_id: rawId,
    };
  }

  protected async persistCanonical(record: ReviewInsert): Promise<string | null> {
    const { data, error } = await this.db
      .from("reviews")
      .upsert(record, { onConflict: "platform,external_id" })
      .select("id")
      .single();

    if (error) throw new Error(`[Reviews] Canonical write failed: ${error.message}`);

    await writeAuditLog({
      entityType: "review",
      entityId:   data.id,
      operation:  "create",
      actorLabel: "system:reviews",
      siteId:     this.siteId,
      afterState: record as unknown as Record<string, unknown>,
    });

    return data.id;
  }
}
