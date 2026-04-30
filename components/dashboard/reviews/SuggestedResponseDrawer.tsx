/**
 * SuggestedResponseDrawer
 *
 * Shows AI-generated response draft for a selected review.
 * Client component. Draft can be copied — not auto-posted.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  reviewId:     string;
  reviewText?:  string | null;
  guestName?:   string | null;
  rating:       number;
  ratingScale?: number;
  source?:      string;
};

const sourceLabel: Record<string, string> = {
  google:      "Google",
  booking_com: "Booking.com",
  tripadvisor: "TripAdvisor",
  airbnb:      "Airbnb",
  manual:      "Manual",
};

export default function SuggestedResponseDrawer({
  reviewId,
  reviewText,
  guestName,
  rating,
  ratingScale = 5,
  source,
}: Props) {
  const [draft, setDraft]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [open, setOpen]           = useState(false);

  const generateDraft = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews/respond", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ review_id: reviewId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Failed to generate response");
        return;
      }
      const data = await res.json();
      setDraft(data.draft ?? null);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-2">
      {/* Trigger button */}
      <button
        onClick={draft ? () => setOpen(!open) : generateDraft}
        disabled={loading}
        className={cn(
          "w-full text-left px-3 py-2 border text-[11px] font-medium transition-colors",
          "border-[#e2e2e0] dark:border-stone-700 bg-white dark:bg-stone-900",
          "hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300",
          loading && "opacity-50 cursor-not-allowed",
        )}
      >
        {loading ? "Generating draft response…" : draft ? "View draft response" : "Generate response draft"}
      </button>

      {error && (
        <p className="text-[10px] text-red-500">{error}</p>
      )}

      {/* Drawer */}
      {draft && open && (
        <div className="border border-[#e2e2e0] dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-4 space-y-3">
          {/* Meta */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-500">
              DRAFT RESPONSE
            </span>
            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-mono">
              Review before posting manually on {sourceLabel[source ?? "manual"] ?? source}
            </span>
          </div>

          {/* Review context */}
          <div className="text-[10px] text-stone-500 space-y-0.5">
            <p>
              <span className="font-medium">Guest:</span> {guestName ?? "Anonymous"} ·{" "}
              <span className="font-medium">Rating:</span> {rating}/{ratingScale}
            </p>
            {reviewText && (
              <p className="line-clamp-2 italic">"{reviewText}"</p>
            )}
          </div>

          {/* Draft text */}
          <pre className="whitespace-pre-wrap text-[11px] text-stone-700 dark:text-stone-300 font-sans leading-relaxed">
            {draft}
          </pre>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={copyToClipboard}
              className={cn(
                "px-3 py-1.5 text-[10px] font-medium border transition-colors",
                copied
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-[#e2e2e0] dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700",
              )}
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              onClick={generateDraft}
              disabled={loading}
              className="px-3 py-1.5 text-[10px] font-medium border border-[#e2e2e0] dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors"
            >
              Regenerate
            </button>
          </div>

          <p className="text-[9px] text-stone-400">
            This draft is saved but not published. Copy and post manually on the review platform.
          </p>
        </div>
      )}
    </div>
  );
}
