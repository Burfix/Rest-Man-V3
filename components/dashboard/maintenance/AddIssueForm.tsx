"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Equipment } from "@/types";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; title: string }
  | { status: "error"; message: string };

interface Props {
  equipment: Equipment[];
  onClose: () => void;
}

export default function AddIssueForm({ equipment, onClose }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const [selectedEquipId, setSelectedEquipId] = useState<string>("");

  // When an existing piece of equipment is selected, pre-fill unit_name + category
  const selectedEquip = equipment.find((e) => e.id === selectedEquipId) ?? null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "submitting" });
    const fd = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/maintenance/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_id: selectedEquip?.id || undefined,
          unit_name: fd.get("unit_name"),
          category: fd.get("category") || selectedEquip?.category || "other",
          issue_title: fd.get("issue_title"),
          issue_description: fd.get("issue_description") || undefined,
          priority: fd.get("priority"),
          repair_status: fd.get("repair_status") || "open",
          date_reported: fd.get("date_reported") || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setState({ status: "error", message: json.error ?? "Failed to log issue." });
        return;
      }

      setState({ status: "success", title: json.log.issue_title });
      router.refresh();
      setTimeout(onClose, 1200);
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
      {state.status === "error" && (
        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          Issue &ldquo;{state.title}&rdquo; logged successfully.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Link to existing equipment (optional) */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Equipment (optional)
          </label>
          <select
            value={selectedEquipId}
            onChange={(e) => setSelectedEquipId(e.target.value)}
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="">— Not linked to existing item —</option>
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.unit_name}{eq.location ? ` (${eq.location})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Unit name — pre-filled when equipment selected */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Unit name <span className="text-red-500">*</span>
          </label>
          <input
            name="unit_name"
            type="text"
            required
            key={selectedEquip?.unit_name ?? "manual"}
            defaultValue={selectedEquip?.unit_name ?? ""}
            placeholder="e.g. Walk-in freezer"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Issue title */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Issue title <span className="text-red-500">*</span>
          </label>
          <input
            name="issue_title"
            type="text"
            required
            placeholder="Brief description of the problem"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Priority <span className="text-red-500">*</span>
          </label>
          <select
            name="priority"
            required
            defaultValue=""
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {/* Repair status */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            name="repair_status"
            defaultValue="open"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          >
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="awaiting_parts">Awaiting Parts</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        {/* Date reported */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date reported
          </label>
          <input
            name="date_reported"
            type="date"
            disabled={isSubmitting}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          />
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            name="issue_description"
            rows={2}
            placeholder="Additional details…"
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
          {isSubmitting ? "Logging…" : "Log Issue"}
        </button>
      </div>
    </form>
  );
}
