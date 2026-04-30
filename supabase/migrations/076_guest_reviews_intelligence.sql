-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 076: Guest Reviews Intelligence
--
-- Changes:
--   1. Add Sea Castle Hotel Camps Bay site
--   2. Extend existing `reviews` table with new columns
--   3. Create `review_insights` table
--   4. Create `review_actions` table
--   5. RLS policies (service_role bypass on all three tables)
--   6. Indexes for common query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add Sea Castle Hotel Camps Bay site ───────────────────────────────────

INSERT INTO sites (id, name, slug, org_id, deployment_stage, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Sea Castle Hotel Camps Bay',
  'seacastlehotelcampsbay',
  (SELECT id FROM organizations LIMIT 1),
  'partial',
  now()
)
ON CONFLICT (id) DO UPDATE
  SET name            = EXCLUDED.name,
      slug            = EXCLUDED.slug,
      deployment_stage = EXCLUDED.deployment_stage;

-- ── 2. Extend existing `reviews` table ───────────────────────────────────────

-- source: maps to existing `platform` but accepts more values (booking_com, airbnb, manual)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source         text,
  ADD COLUMN IF NOT EXISTS rating_scale   numeric(4,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS category_tags  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS urgency        text         NOT NULL DEFAULT 'low'
    CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS review_status  text         NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'reviewed', 'action_required', 'responded', 'closed')),
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sentiment_label text
    CHECK (sentiment_label IN ('positive', 'neutral', 'negative', 'mixed'));

-- Back-fill source from platform for existing rows
UPDATE reviews SET source = platform WHERE source IS NULL;

-- Make source NOT NULL after back-fill
ALTER TABLE reviews ALTER COLUMN source SET NOT NULL;
ALTER TABLE reviews ALTER COLUMN source SET DEFAULT 'manual';

COMMENT ON COLUMN reviews.source          IS 'Review origin: google, booking_com, tripadvisor, airbnb, manual';
COMMENT ON COLUMN reviews.rating_scale    IS 'Maximum rating value for the source platform (default 5)';
COMMENT ON COLUMN reviews.category_tags   IS 'Operational tags: cleanliness, service, location, breakfast, noise, value, maintenance';
COMMENT ON COLUMN reviews.urgency         IS 'Urgency level derived from content and rating';
COMMENT ON COLUMN reviews.review_status   IS 'Workflow status: new, reviewed, action_required, responded, closed';
COMMENT ON COLUMN reviews.sentiment_label IS 'AI-classified sentiment: positive, neutral, negative, mixed';

-- Additional indexes
CREATE INDEX IF NOT EXISTS idx_reviews_urgency       ON reviews (site_id, urgency);
CREATE INDEX IF NOT EXISTS idx_reviews_status        ON reviews (site_id, review_status);
CREATE INDEX IF NOT EXISTS idx_reviews_source        ON reviews (source);
CREATE INDEX IF NOT EXISTS idx_reviews_sentiment_lbl ON reviews (sentiment_label);

-- ── 3. review_insights ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_insights (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_start         date        NOT NULL,
  period_end           date        NOT NULL,
  average_rating       numeric(4,2),
  total_reviews        integer     NOT NULL DEFAULT 0,
  positive_count       integer     NOT NULL DEFAULT 0,
  neutral_count        integer     NOT NULL DEFAULT 0,
  negative_count       integer     NOT NULL DEFAULT 0,
  top_positive_themes  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  top_negative_themes  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  operational_risks    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  review_insights IS 'Aggregated review intelligence per site per period';
COMMENT ON COLUMN review_insights.operational_risks   IS 'Flagged risks derived from review content (e.g. cleanliness, safety)';
COMMENT ON COLUMN review_insights.recommended_actions IS 'Suggested GM actions based on review patterns';

CREATE INDEX IF NOT EXISTS idx_review_insights_site        ON review_insights (site_id);
CREATE INDEX IF NOT EXISTS idx_review_insights_period      ON review_insights (site_id, period_end DESC);

ALTER TABLE review_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_insights_service_role ON review_insights
  TO service_role USING (true) WITH CHECK (true);

-- ── 4. review_actions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_actions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  review_id    uuid        REFERENCES reviews(id) ON DELETE SET NULL,
  title        text        NOT NULL,
  description  text,
  department   text        NOT NULL DEFAULT 'management'
    CHECK (department IN ('housekeeping', 'front_desk', 'maintenance', 'management', 'reservations')),
  priority     text        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status       text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  due_date     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  review_actions IS 'Actionable tasks created from guest review analysis';
COMMENT ON COLUMN review_actions.department IS 'Responsible department: housekeeping, front_desk, maintenance, management, reservations';

CREATE INDEX IF NOT EXISTS idx_review_actions_site     ON review_actions (site_id);
CREATE INDEX IF NOT EXISTS idx_review_actions_review   ON review_actions (review_id);
CREATE INDEX IF NOT EXISTS idx_review_actions_status   ON review_actions (site_id, status);
CREATE INDEX IF NOT EXISTS idx_review_actions_priority ON review_actions (site_id, priority);

ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_actions_service_role ON review_actions
  TO service_role USING (true) WITH CHECK (true);
