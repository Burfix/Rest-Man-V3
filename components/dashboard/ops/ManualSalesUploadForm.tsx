/**
 * ManualSalesUploadForm — Inline form for entering daily sales when MICROS is offline.
 *
 * Shown in the live-data strip area when no live POS data is available.
 * Minimal fields: gross sales, covers, checks, optional notes.
 * Posts to /api/sales/manual-upload.
 */

"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

interface Props {
  businessDate: string;
  onSuccess?: () => void;
}

export default function ManualSalesUploadForm({ businessDate, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [grossSales, setGrossSales] = useState("");
  const [covers, setCovers] = useState("");
  const [checks, setChecks] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const gs = parseFloat(grossSales);
    if (isNaN(gs) || gs <= 0) {
      setError("Gross sales must be a positive number");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/sales/manual-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_date: businessDate,
            gross_sales: gs,
            covers: parseInt(covers, 10) || 0,
            checks: parseInt(checks, 10) || 0,
            notes: notes || null,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Upload failed (${res.status})`);
          return;
        }

        setSuccess(true);
        setOpen(false);
        onSuccess?.();
      } catch {
        setError("Network error — please try again");
      }
    });
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-700">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
        Manual sales uploaded for {businessDate}
        <button
          onClick={() => window.location.reload()}
          className="ml-auto text-[11px] font-medium text-sky-600 hover:text-sky-800 underline"
        >
          Refresh dashboard
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 px-4 py-2.5 text-xs">
        <span className="text-stone-500 dark:text-stone-400">
          No live POS data — enter today&apos;s sales manually
        </span>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 rounded bg-stone-800 dark:bg-stone-200 px-3 py-1 text-[11px] font-semibold text-white dark:text-stone-800 hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
        >
          Enter sales
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-600 dark:text-stone-400">
          Manual Sales Entry · {businessDate}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-[10px] font-medium text-stone-500 dark:text-stone-500 mb-1">
            Gross Sales (R) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={grossSales}
            onChange={(e) => setGrossSales(e.target.value)}
            className="w-full rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2 py-1.5 text-xs text-stone-800 dark:text-stone-200 focus:ring-1 focus:ring-stone-400"
            placeholder="12500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-stone-500 dark:text-stone-500 mb-1">
            Covers
          </label>
          <input
            type="number"
            min="0"
            value={covers}
            onChange={(e) => setCovers(e.target.value)}
            className="w-full rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2 py-1.5 text-xs text-stone-800 dark:text-stone-200 focus:ring-1 focus:ring-stone-400"
            placeholder="45"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-stone-500 dark:text-stone-500 mb-1">
            Checks
          </label>
          <input
            type="number"
            min="0"
            value={checks}
            onChange={(e) => setChecks(e.target.value)}
            className="w-full rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2 py-1.5 text-xs text-stone-800 dark:text-stone-200 focus:ring-1 focus:ring-stone-400"
            placeholder="30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-stone-500 dark:text-stone-500 mb-1">
            Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-2 py-1.5 text-xs text-stone-800 dark:text-stone-200 focus:ring-1 focus:ring-stone-400"
            placeholder="End of day"
          />
        </div>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "rounded px-4 py-1.5 text-[11px] font-semibold transition-colors",
            isPending
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-800 hover:bg-stone-700 dark:hover:bg-stone-300"
          )}
        >
          {isPending ? "Uploading…" : "Upload Sales"}
        </button>
      </div>
    </form>
  );
}
