"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; name: string }
  | { status: "error"; message: string };

export default function AddEquipmentForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "submitting" });
    const fd = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/maintenance/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_name: fd.get("unit_name"),
          category: fd.get("category"),
          location: fd.get("location") || undefined,
          status: fd.get("status"),
          notes: fd.get("notes") || undefined,
          serial_number: fd.get("serial_number") || undefined,
          supplier: fd.get("supplier") || undefined,
          purchase_date: fd.get("purchase_date") || undefined,
          warranty_expiry: fd.get("warranty_expiry") || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setState({ status: "error", message: json.error ?? "Failed to add equipment." });
        return;
      }

      setState({ status: "success", name: json.equipment.unit_name });
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
          &ldquo;{state.name}&rdquo; added successfully.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="form-label">
            Unit name <span className="text-red-500">*</span>
          </label>
          <input
            name="unit_name"
            type="text"
            required
            placeholder="e.g. Convection Oven #2"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            name="category"
            required
            disabled={isSubmitting}
            defaultValue=""
            className="form-input"
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
            <option value="facilities">Facilities</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="form-label">
            Status
          </label>
          <select
            name="status"
            defaultValue="operational"
            disabled={isSubmitting}
            className="form-input"
          >
            <option value="operational">Operational</option>
            <option value="needs_attention">Needs Attention</option>
            <option value="out_of_service">Out of Service</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="form-label">
            Location
          </label>
          <input
            name="location"
            type="text"
            placeholder="e.g. Main kitchen, rear wall"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        <div className="col-span-2">
          <label className="form-label">
            Notes
          </label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Any additional details…"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        {/* Asset profile fields */}
        <div>
          <label className="form-label">
            Serial number
          </label>
          <input
            name="serial_number"
            type="text"
            placeholder="e.g. SN-2024-001"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">
            Supplier
          </label>
          <input
            name="supplier"
            type="text"
            placeholder="e.g. Cape Kitchen Supplies"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">
            Purchase date
          </label>
          <input
            name="purchase_date"
            type="date"
            disabled={isSubmitting}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label">
            Warranty expiry
          </label>
          <input
            name="warranty_expiry"
            type="date"
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
          {isSubmitting ? "Adding…" : "Add Equipment"}
        </button>
      </div>
    </form>
  );
}
