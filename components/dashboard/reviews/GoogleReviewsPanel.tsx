"use client";

import { useState, useCallback, useEffect } from "react";
import type { GoogleSyncResult, GoogleSyncReview } from "@/app/api/reviews/google-sync/route";
import { cn } from "@/lib/utils";

interface Props {
  siteId: string;
  placeId: string | null;
  initialData: GoogleSyncResult | null;
}

export default function GoogleReviewsPanel({ siteId, placeId, initialData }: Props) {
  const [data, setData] = useState<GoogleSyncResult | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  useEffect(() => {
    if (initialData != null) setLastSynced(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/google-sync?siteId=${siteId}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const fresh: GoogleSyncResult = await res.json();
      setData(fresh);
      setLastSynced(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // ── Not connected ────────────────────────────────────────────────────────────
  if (data && !data.connected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
        <div className="mb-2 text-2xl">🔌</div>
        <p className="text-sm font-semibold text-stone-600">
          Google Reviews not connected
        </p>
        <p className="mt-1 max-w-xs text-xs text-stone-500">
          Add a Google Place ID to this site in Settings to enable live review
          data.
        </p>
      </div>
    );
  }

  // ── No data yet (API key missing or first load failed) ────────────────────
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
        <p className="text-sm font-semibold text-stone-600">Google Reviews</p>
        <p className="mt-1 max-w-xs text-xs text-stone-500">
          Connect Google Places to see reviews.
        </p>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="mt-4 rounded-md bg-stone-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Connecting…" : "Try connect"}
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const viewAllUrl = placeId
    ? `https://search.google.com/local/reviews?placeid=${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Si Cantina Sociale Cape Town")}`;

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      {/* ── Rating summary header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Google G logo */}
          <span className="text-sm font-bold leading-none">
            <span className="text-[#4285F4]">G</span>
            <span className="text-[#EA4335]">o</span>
            <span className="text-[#FBBC05]">o</span>
            <span className="text-[#4285F4]">g</span>
            <span className="text-[#34A853]">l</span>
            <span className="text-[#EA4335]">e</span>
          </span>
          <div className="flex items-center gap-1">
            <StarRating rating={data.totalRating} size="sm" />
            <span className="text-sm font-bold text-stone-800">
              {data.totalRating.toFixed(1)}
            </span>
            <span className="text-xs text-stone-400">·</span>
            <span className="text-xs text-stone-500">
              {data.totalCount.toLocaleString()} reviews
            </span>
            <span className="text-xs text-stone-400">·</span>
            <a
              href={viewAllUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              View on Google Maps →
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastSynced && (
            <span className="text-xs text-stone-400">
              Synced {formatRelative(lastSynced)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50 transition-colors"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* ── Review cards ─────────────────────────────────────────────────── */}
      {data.reviews.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-stone-400">
          No review text available from Google.
        </p>
      ) : (
        <ul className="divide-y divide-stone-50">
          {data.reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="border-t border-stone-100 px-4 py-2.5">
        <a
          href={viewAllUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          View all reviews on Google →
        </a>
      </div>
    </div>
  );
}

// ── Review card ────────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: GoogleSyncReview }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.text.length > 180;

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        {/* Avatar + name */}
        <div className="flex min-w-0 items-center gap-2.5">
          {review.reviewerPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.reviewerPhoto}
              alt={review.reviewerName}
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-bold text-stone-500">
              {review.reviewerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-stone-800">
              {review.reviewerName}
            </p>
            <p className="text-xs text-stone-400">{review.date}</p>
          </div>
        </div>

        {/* Star rating + Google badge */}
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <StarRating rating={review.rating} size="md" />
          <span className="text-[10px] text-stone-400">Google</span>
        </div>
      </div>

      {/* Review text with expand */}
      {review.text && (
        <div className="mt-2">
          <p
            className={cn(
              "text-xs leading-relaxed text-stone-600",
              !expanded && "line-clamp-3",
            )}
          >
            {review.text}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-xs font-medium text-blue-500 hover:underline"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Star rating component ─────────────────────────────────────────────────────

function StarRating({ rating, size }: { rating: number; size: "sm" | "md" }) {
  const full = Math.floor(rating);
  const empty = 5 - full;
  const cls = size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("leading-none text-amber-400", cls)}>
      {"★".repeat(full)}
      <span className="text-stone-300">{"★".repeat(empty)}</span>
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
