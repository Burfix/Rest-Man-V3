"use client";

/**
 * GoogleReviewsSettingsCard
 *
 * Allows admins to connect a Google Place ID to a site so that
 * Google Reviews sync becomes active.
 *
 * Props:
 *   siteId        — the site UUID
 *   siteName      — display name (shown when multi-site)
 *   currentPlaceId — existing value from sites.google_place_id (or null)
 */

import { useState, useTransition } from "react";

interface Props {
  siteId: string;
  siteName?: string;
  currentPlaceId: string | null;
}

export default function GoogleReviewsSettingsCard({
  siteId,
  siteName,
  currentPlaceId,
}: Props) {
  const [placeId, setPlaceId]     = useState(currentPlaceId ?? "");
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isConnected = Boolean(currentPlaceId);
  const isDirty     = placeId.trim() !== (currentPlaceId ?? "");

  async function handleSave() {
    setError(null);
    setSaved(false);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/sites/${siteId}/google-place-id`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ google_place_id: placeId.trim() }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Failed to save. Please try again.");
          return;
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        // Reload to reflect new state from server
        window.location.reload();
      } catch {
        setError("Network error. Please check your connection.");
      }
    });
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);

    try {
      const res = await fetch(`/api/reviews/google-sync?siteId=${siteId}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Sync failed.");
      } else {
        const count = data.synced ?? data.reviews?.length ?? 0;
        setSyncMsg(`Synced ${count} review${count !== 1 ? "s" : ""} successfully.`);
        setTimeout(() => setSyncMsg(null), 5000);
      }
    } catch {
      setError("Sync request failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Google icon */}
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white dark:border-stone-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                Google Reviews
              </h3>
              {siteName && (
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {siteName}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Live review sync · Sentiment analysis · Guest intelligence
            </p>
          </div>
        </div>

        {/* Connection badge */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            isConnected
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          {isConnected ? "Connected" : "Not connected"}
        </span>
      </div>

      {/* Divider */}
      <div className="my-5 border-t border-stone-100 dark:border-stone-800" />

      {/* Place ID field */}
      <div className="space-y-2">
        <label
          htmlFor={`place-id-${siteId}`}
          className="block text-xs font-medium text-stone-700 dark:text-stone-300"
        >
          Google Place ID
        </label>
        <div className="flex gap-2">
          <input
            id={`place-id-${siteId}`}
            type="text"
            value={placeId}
            onChange={(e) => {
              setPlaceId(e.target.value);
              setSaved(false);
              setError(null);
            }}
            placeholder="ChIJ55SFcllnzB0RaIHBvQkNTxs"
            spellCheck={false}
            className="flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-900 placeholder-stone-400 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-700"
          />
          <button
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="rounded-md bg-stone-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Helper text */}
        <p className="text-xs text-stone-400 dark:text-stone-500">
          Find your Place ID at{" "}
          <a
            href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300"
          >
            Google Place ID Finder
          </a>
          . Search for your venue name and copy the ID.
        </p>
      </div>

      {/* Feedback messages */}
      {saved && (
        <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          ✓ Place ID saved successfully.
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">
          ✗ {error}
        </p>
      )}

      {/* Manual sync — only shown when connected */}
      {isConnected && (
        <>
          <div className="my-5 border-t border-stone-100 dark:border-stone-800" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                Manual sync
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                Pull latest reviews now. Auto-sync runs every hour via cron.
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              {syncing ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Syncing…
                </>
              ) : (
                <>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Sync now
                </>
              )}
            </button>
          </div>
          {syncMsg && (
            <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ✓ {syncMsg}
            </p>
          )}
        </>
      )}
    </div>
  );
}
