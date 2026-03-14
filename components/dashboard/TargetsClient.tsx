"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { SalesTarget } from "@/types";
import { formatCurrency, formatShortDate } from "@/lib/utils";

interface Props {
  targets: SalesTarget[];
}

type FormState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function TargetsClient({ targets: initialTargets }: Props) {
  const router     = useRouter();
  const formRef    = useRef<HTMLFormElement>(null);
  const [formState, setFormState] = useState<FormState>({ status: "idle" });
  const [targets, setTargets] = useState<SalesTarget[]>(initialTargets);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormState({ status: "saving" });

    const fd          = new FormData(e.currentTarget);
    const target_date  = fd.get("target_date") as string;
    const target_sales = (fd.get("target_sales") as string).trim();
    const target_covers = (fd.get("target_covers") as string).trim();
    const notes        = (fd.get("notes") as string).trim();

    if (!target_date) {
      setFormState({ status: "error", message: "Please select a date." });
      return;
    }

    try {
      const res = await fetch("/api/revenue/targets", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_date,
          target_sales:  target_sales  ? parseFloat(target_sales)  : null,
          target_covers: target_covers ? parseFloat(target_covers) : null,
          notes:         notes || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setFormState({ status: "error", message: json.error ?? "Failed to save target." });
        return;
      }

      setFormState({ status: "success", message: `Target saved for ${formatShortDate(target_date)}.` });
      formRef.current?.reset();
      router.refresh();

      // Optimistic update: replace or insert the returned target in local state
      const saved = json.target as SalesTarget;
      setTargets((prev) => {
        const idx = prev.findIndex((t) => t.target_date === saved.target_date);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next.sort((a, b) => a.target_date.localeCompare(b.target_date));
        }
        return [...prev, saved].sort((a, b) => a.target_date.localeCompare(b.target_date));
      });
    } catch (err) {
      setFormState({
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  async function handleDelete(id: string, dateStr: string) {
    if (!confirm(`Remove target for ${formatShortDate(dateStr)}?`)) return;

    try {
      const res = await fetch(`/api/revenue/targets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTargets((prev) => prev.filter((t) => t.id !== id));
        router.refresh();
      }
    } catch {
      // non-critical — refresh will show current state
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Add / edit target form ── */}
      <div className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-semibold text-stone-900">Set a Revenue Target</h2>
        <p className="mb-5 text-xs text-stone-500">
          Targets are used by the Revenue Intelligence Engine to calculate gaps and drive
          recommendations on the Operations dashboard.
        </p>

        {formState.status === "success" && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
            ✓ {formState.message}
          </div>
        )}
        {formState.status === "error" && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {formState.message}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-stone-700">Date *</label>
            <input
              type="date"
              name="target_date"
              required
              disabled={formState.status === "saving"}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-stone-700">
              Target Sales (R, ex-VAT)
            </label>
            <input
              type="number"
              name="target_sales"
              min="0"
              step="0.01"
              placeholder="e.g. 18000"
              disabled={formState.status === "saving"}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-stone-700">
              Target Covers
            </label>
            <input
              type="number"
              name="target_covers"
              min="0"
              step="1"
              placeholder="e.g. 70"
              disabled={formState.status === "saving"}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 disabled:opacity-50"
            />
          </div>

          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-1">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-stone-700">Notes</label>
              <input
                type="text"
                name="notes"
                placeholder="Optional"
                disabled={formState.status === "saving"}
                className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={formState.status === "saving"}
              className="shrink-0 self-end rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {formState.status === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>

      {/* ── Target list ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-stone-700">Upcoming Targets</h2>
        {targets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
            <p className="text-sm text-stone-500">No targets set yet.</p>
            <p className="mt-1 text-xs text-stone-400">
              Set a target above to enable gap analysis on the dashboard.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Target Sales</th>
                  <th className="px-4 py-3 text-right">Target Covers</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {targets.map((t) => (
                  <tr key={t.id} className="hover:bg-stone-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
                      {formatShortDate(t.target_date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-stone-900">
                      {t.target_sales != null ? formatCurrency(t.target_sales) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-stone-700">
                      {t.target_covers != null ? Math.round(t.target_covers) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400">{t.notes ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(t.id, t.target_date)}
                        className="text-xs text-red-400 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
