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
  id:              string;
  reviewer_name?:  string | null;
  rating:          number;
  rating_scale?:   number;
  review_date:     string;
  review_text?:    string | null;
  source?:         string;
  sentiment_label?: string | null;
  category_tags?:  string[] | null;
  review_status?:  string;
  urgency?:        string;
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
                  {(r.category_tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[9px] text-stone-500 capitalize">
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
