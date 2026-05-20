"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; platform: string; rating: string }
  | { status: "error"; message: string };

export default function AddReviewForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "submitting" });
    const fd = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: fd.get("platform"),
          review_date: fd.get("review_date"),
          rating: fd.get("rating"),
          reviewer_name: fd.get("reviewer_name") || undefined,
          review_text: fd.get("review_text") || undefined,
          sentiment: fd.get("sentiment") || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setState({ status: "error", message: json.error ?? "Failed to add review." });
        return;
      }

      setState({
        status: "success",
        platform: (fd.get("platform") as string) ?? "review",
        rating: (fd.get("rating") as string) ?? "",
      });

      router.refresh();
      setTimeout(onClose, 1400);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  const isSubmitting = state.status === "submitting";

  // Default date = today (SA time)
  const todaySA = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {state.status === "error" && (
        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          {state.platform.charAt(0).toUpperCase() + state.platform.slice(1)}{" "}
          review ({state.rating}★) added. The log below has refreshed.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Platform */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Platform <span className="text-red-500">*</span>
          </label>
          <select
            name="platform"
            required
            defaultValue=""
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="google">Google</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Review date */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Review date <span className="text-red-500">*</span>
          </label>
          <input
            name="review_date"
            type="date"
            required
            defaultValue={todaySA}
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Rating */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Rating <span className="text-red-500">*</span>
          </label>
          <select
            name="rating"
            required
            defaultValue=""
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="5">5 ★ — Excellent</option>
            <option value="4">4 ★ — Good</option>
            <option value="3">3 ★ — Neutral</option>
            <option value="2">2 ★ — Poor</option>
            <option value="1">1 ★ — Terrible</option>
          </select>
        </div>

        {/* Sentiment override */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Sentiment{" "}
            <span className="font-normal text-gray-400">(auto-inferred)</span>
          </label>
          <select
            name="sentiment"
            defaultValue=""
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="">Auto</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
        </div>

        {/* Reviewer name */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Reviewer name
          </label>
          <input
            name="reviewer_name"
            type="text"
            placeholder="e.g. Anonymous Guest"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Review text */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Review text
          </label>
          <textarea
            name="review_text"
            rows={3}
            placeholder="Customer's review content…"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50 resize-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Adding…" : "Add Review"}
        </button>
      </div>
    </form>
  );
}
