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
          impact_level: fd.get("impact_level") || "none",
          reported_by: fd.get("reported_by") || undefined,
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
          <label className="form-label">
            Equipment (optional)
          </label>
          <select
            value={selectedEquipId}
            onChange={(e) => setSelectedEquipId(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
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
          <label className="form-label">
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
            className="form-input"
          />
        </div>

        {/* Issue title */}
        <div className="col-span-2">
          <label className="form-label">
            Issue title <span className="text-red-500">*</span>
          </label>
          <input
            name="issue_title"
            type="text"
            required
            placeholder="Brief description of the problem"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="form-label">
            Priority <span className="text-red-500">*</span>
          </label>
          <select
            name="priority"
            required
            defaultValue=""
            disabled={isSubmitting}
            className="form-input"
          >
            <option value="" disabled>Select…</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {/* Business impact */}
        <div>
          <label className="form-label">
            Business Impact <span className="text-red-500">*</span>
          </label>
          <select
            name="impact_level"
            required
            defaultValue="none"
            disabled={isSubmitting}
            className="form-input"
          >
            <option value="none">No operational impact</option>
            <option value="minor">Minor impact</option>
            <option value="service_disruption">Service disruption</option>
            <option value="revenue_loss">Revenue loss</option>
            <option value="compliance_risk">Compliance risk</option>
            <option value="food_safety_risk">⚠ Food safety risk</option>
          </select>
        </div>

        {/* Reported by */}
        <div className="col-span-2">
          <label className="form-label">
            Reported by
          </label>
          <input
            name="reported_by"
            type="text"
            placeholder="e.g. Marco, FOH Manager"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        {/* Repair status */}
        <div>
          <label className="form-label">
            Status
          </label>
          <select
            name="repair_status"
            defaultValue="open"
            disabled={isSubmitting}
            className="form-input"
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
          <label className="form-label">
            Date reported
          </label>
          <input
            name="date_reported"
            type="date"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="form-label">
            Description
          </label>
          <textarea
            name="issue_description"
            rows={2}
            placeholder="Additional details…"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md px-3 py-2 text-sm disabled:opacity-50"
          style={{ color: "var(--text-secondary)" }}
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
