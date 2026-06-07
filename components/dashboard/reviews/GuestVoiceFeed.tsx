/**
 * GuestVoiceFeed
 *
 * Shows latest reviews with source, guest name, rating,
 * date, sentiment, tags, and status.
 * Hotel/hospitality grade.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type ReviewRow = {
  id:                string;
  reviewer_name?:    string | null;
  rating:            number;
  rating_scale?:     number;
  review_date:       string;
  review_text?:      string | null;
  source?:           string;
  sentiment_label?:  string | null;
  category_tags?:    string[] | null;
  review_status?:    string;
  urgency?:          string;
  // GMB reply fields
  gmb_review_name?:  string | null;
  ai_reply_draft?:   string | null;
  reply_posted_at?:  string | null;
};

type Props = {
  reviews: ReviewRow[];
};

const sentimentStyle: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  neutral:  "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
  negative: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  mixed:    "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
};

const statusStyle: Record<string, string> = {
  new:              "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  reviewed:         "bg-stone-100 text-stone-500",
  action_required:  "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  responded:        "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  closed:           "bg-stone-100 text-stone-400",
};

const sourceIcon: Record<string, string> = {
  google:      "G",
  booking_com: "B",
  tripadvisor: "T",
  airbnb:      "A",
  manual:      "M",
};

const sourceColor: Record<string, string> = {
  google:      "bg-blue-100 text-blue-600",
  booking_com: "bg-cyan-100 text-cyan-700",
  tripadvisor: "bg-green-100 text-green-700",
  airbnb:      "bg-rose-100 text-rose-600",
  manual:      "bg-stone-100 text-stone-500",
};

function StarRow({ rating, max = 5 }: { rating: number; max?: number }) {
  const filled = Math.round((rating / max) * 5);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className={cn("h-3 w-3", i < filled ? "text-amber-400" : "text-stone-200 dark:text-stone-700")}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  );
}

// ── Reply panel (per-card state) ────────────────────────────────────────────

function ReplyPanel({ review }: { review: ReviewRow }) {
  const [draft, setDraft]       = useState(review.ai_reply_draft ?? "");
  const [posting, setPosting]   = useState(false);
  const [posted, setPosted]     = useState(Boolean(review.reply_posted_at));
  const [error, setError]       = useState<string | null>(null);
  const [postedAt, setPostedAt] = useState(review.reply_posted_at ?? null);

  if (!review.gmb_review_name) {
    // Not a GMB review — no reply panel
    return null;
  }

  if (posted) {
    return (
      <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-900/20">
        <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Reply posted to Google
          {postedAt && (
            <span className="ml-2 font-normal text-emerald-600">
              {new Date(postedAt).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
        </p>
        {draft && (
          <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-500 italic">
            &ldquo;{draft.slice(0, 120)}{draft.length > 120 ? '…' : ''}&rdquo;
          </p>
        )}
      </div>
    );
  }

  async function handlePost() {
    if (!draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews/reply", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ review_id: review.id, reply_text: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to post reply. Please try again.");
      } else {
        setPosted(true);
        setPostedAt(data.reply_posted_at ?? new Date().toISOString());
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-[9px] uppercase tracking-widest font-medium text-stone-400">
        AI Draft Reply
      </p>
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        rows={4}
        placeholder="Edit the draft reply before approving…"
        className="w-full rounded border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-800 placeholder-stone-400 outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder-stone-600 resize-none"
      />
      {error && (
        <p className="text-[10px] font-medium text-red-600 dark:text-red-400">✗ {error}</p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-stone-400">{draft.length}/4096</p>
        <button
          onClick={handlePost}
          disabled={posting || !draft.trim()}
          className="flex items-center gap-1.5 rounded bg-stone-900 px-3 py-1.5 text-[10px] font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
        >
          {posting ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Posting…
            </>
          ) : (
            "Approve & Post to Google"
          )}
        </button>
      </div>
    </div>
  );
}

export default function GuestVoiceFeed({ reviews }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (reviews.length === 0) {
    return (
      <div className="border border-[#e2e2e0] dark:border-stone-800 p-5 text-center">
        <p className="text-sm text-stone-400">No reviews yet</p>
        <p className="mt-1 text-[11px] text-stone-400">Import reviews manually or connect a platform</p>
      </div>
    );
  }

  return (
    <div className="border border-[#e2e2e0] dark:border-stone-800 bg-white dark:bg-[#0f0f0f] divide-y divide-[#e2e2e0] dark:divide-stone-800">
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-600">
          GUEST VOICE
        </span>
        <span className="text-[9px] font-mono text-stone-400">{reviews.length} reviews</span>
      </div>

      {reviews.map((r) => {
        const isExpanded = expanded === r.id;
        const src = r.source ?? "manual";
        const sentiment = r.sentiment_label ?? (r.rating >= 4 ? "positive" : r.rating >= 3 ? "neutral" : "negative");
        const hasReply   = Boolean(r.reply_posted_at);
        const hasGmb     = Boolean(r.gmb_review_name);

        return (
          <div
            key={r.id}
            className="px-5 py-3 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/30 transition-colors"
            onClick={() => setExpanded(isExpanded ? null : r.id)}
          >
            <div className="flex items-start gap-3">
              {/* Source badge */}
              <span className={cn(
                "mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0",
                sourceColor[src] ?? "bg-stone-100 text-stone-500",
              )}>
                {sourceIcon[src] ?? "?"}
              </span>

              <div className="flex-1 min-w-0 space-y-1">
                {/* Row 1: name + rating + date */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
                    {r.reviewer_name ?? "Anonymous Guest"}
                  </span>
                  <StarRow rating={r.rating} max={r.rating_scale ?? 5} />
                  <span className="text-[9px] font-mono text-stone-400 ml-auto">{r.review_date}</span>
                </div>

                {/* Row 2: review text preview */}
                {r.review_text && (
                  <p className={cn(
                    "text-[11px] text-stone-500 dark:text-stone-400",
                    isExpanded ? "" : "line-clamp-2",
                  )}>
                    {r.review_text}
                  </p>
                )}

                {/* Row 3: badges */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {sentiment && (
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-medium",
                      sentimentStyle[sentiment] ?? sentimentStyle.neutral,
                    )}>
                      {sentiment}
                    </span>
                  )}
                  {r.review_status && r.review_status !== "new" && (
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-medium",
                      statusStyle[r.review_status] ?? "",
                    )}>
                      {r.review_status.replace(/_/g, " ")}
                    </span>
                  )}
                  {/* GMB reply state */}
                  {hasGmb && !hasReply && r.ai_reply_draft && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      reply ready
                    </span>
                  )}
                  {hasGmb && hasReply && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      ✓ replied
                    </span>
                  )}
                  {(r.category_tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[9px] text-stone-500 capitalize">
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                {/* Expanded: AI reply panel */}
                {isExpanded && <ReplyPanel review={r} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
