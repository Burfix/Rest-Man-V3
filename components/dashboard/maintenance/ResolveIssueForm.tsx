"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MaintenanceLog } from "@/types";

type FixedByType = "internal_staff" | "contractor" | "supplier" | "unknown";

interface Props {
  /** The open issue to resolve */
  issue: MaintenanceLog;
  onClose: () => void;
}

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export default function ResolveIssueForm({ issue, onClose }: Props) {
  const router = useRouter();
  const [state, setState]       = useState<State>({ status: "idle" });
  const [fixedByType, setType]  = useState<FixedByType>("internal_staff");
  const [followUp, setFollowUp] = useState(false);

  const todayISO = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg",
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "submitting" });
    const fd = new FormData(e.currentTarget);

    const payload: Record<string, string | number | boolean | undefined> = {
      id:             issue.id,
      repair_status:  "resolved",
      fixed_by:       (fd.get("fixed_by") as string)?.trim() || undefined,
      fixed_by_type:  fixedByType,
      date_fixed:     (fd.get("date_fixed") as string) || todayISO,
      resolution_notes: (fd.get("resolution_notes") as string)?.trim() || undefined,
      root_cause:       (fd.get("root_cause") as string)?.trim() || undefined,
      follow_up_required: followUp,
    };

    if (fixedByType === "contractor") {
      payload.contractor_name    = (fd.get("contractor_name") as string)?.trim() || undefined;
      payload.contractor_contact = (fd.get("contractor_contact") as string)?.trim() || undefined;
    }

    const actualCost = fd.get("actual_cost") as string;
    if (actualCost) payload.actual_cost = parseFloat(actualCost);

    const downtime = fd.get("downtime_minutes") as string;
    if (downtime) payload.downtime_minutes = parseInt(downtime, 10);

    if (followUp) {
      payload.follow_up_notes = (fd.get("follow_up_notes") as string)?.trim() || undefined;
    }

    try {
      const res = await fetch("/api/maintenance/issue", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setState({ status: "error", message: json.error ?? "Failed to resolve issue." });
        return;
      }
      setState({ status: "success" });
      router.refresh();
      setTimeout(onClose, 1000);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  const isSubmitting = state.status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Issue header */}
      <div className="rounded-md bg-stone-50 border border-stone-200 px-3 py-2">
        <p className="text-xs text-stone-500 font-medium uppercase tracking-wide">Resolving</p>
        <p className="text-sm font-semibold text-stone-800 mt-0.5">{issue.unit_name} — {issue.issue_title}</p>
      </div>

      {state.status === "error" && (
        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          Issue resolved successfully.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Who fixed it */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Fixed by
          </label>
          <input
            name="fixed_by"
            type="text"
            placeholder="e.g. Marco, BM Refrigeration"
            disabled={isSubmitting}
            className={inputCls}
          />
        </div>

        {/* Type of fixer */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Fixed by type
          </label>
          <select
            value={fixedByType}
            onChange={(e) => setType(e.target.value as FixedByType)}
            disabled={isSubmitting}
            className={inputCls}
          >
            <option value="internal_staff">Internal staff</option>
            <option value="contractor">Contractor</option>
            <option value="supplier">Supplier</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        {/* Date fixed */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date fixed
          </label>
          <input
            name="date_fixed"
            type="date"
            defaultValue={todayISO}
            max={todayISO}
            disabled={isSubmitting}
            className={inputCls}
          />
        </div>

        {/* Contractor fields — only when type = contractor */}
        {fixedByType === "contractor" && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Contractor name
              </label>
              <input
                name="contractor_name"
                type="text"
                placeholder="e.g. BM Refrigeration"
                disabled={isSubmitting}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Contractor contact
              </label>
              <input
                name="contractor_contact"
                type="text"
                placeholder="Phone or email"
                disabled={isSubmitting}
                className={inputCls}
              />
            </div>
          </>
        )}

        {/* Cost & downtime */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Actual cost (R)
          </label>
          <input
            name="actual_cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            disabled={isSubmitting}
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Downtime (minutes)
          </label>
          <input
            name="downtime_minutes"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            disabled={isSubmitting}
            className={inputCls}
          />
        </div>

        {/* Root cause */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Root cause
          </label>
          <textarea
            name="root_cause"
            rows={2}
            placeholder="What caused the issue?"
            disabled={isSubmitting}
            className={inputCls + " resize-none"}
          />
        </div>

        {/* Resolution notes */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Resolution notes
          </label>
          <textarea
            name="resolution_notes"
            rows={2}
            placeholder="What was done to fix it?"
            disabled={isSubmitting}
            className={inputCls + " resize-none"}
          />
        </div>

        {/* Follow-up required */}
        <div className="col-span-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(e) => setFollowUp(e.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-xs font-medium text-gray-700">Follow-up required</span>
          </label>
        </div>

        {followUp && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Follow-up notes
            </label>
            <textarea
              name="follow_up_notes"
              rows={2}
              placeholder="What follow-up work is needed?"
              disabled={isSubmitting}
              className={inputCls + " resize-none"}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? "Saving…" : "✓ Mark Resolved"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50";
