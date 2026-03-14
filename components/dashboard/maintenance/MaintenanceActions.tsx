"use client";

import { useState } from "react";
import type { Equipment } from "@/types";
import AddEquipmentForm from "./AddEquipmentForm";
import AddIssueForm from "./AddIssueForm";

type ActivePanel = "equipment" | "issue" | null;

export default function MaintenanceActions({
  equipment,
}: {
  equipment: Equipment[];
}) {
  const [active, setActive] = useState<ActivePanel>(null);

  function toggle(panel: ActivePanel) {
    setActive((prev) => (prev === panel ? null : panel));
  }

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => toggle("equipment")}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
            active === "equipment"
              ? "border-amber-500 bg-amber-50 text-amber-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          Add Equipment
        </button>

        <button
          onClick={() => toggle("issue")}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
            active === "issue"
              ? "border-red-400 bg-red-50 text-red-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          Log Issue
        </button>
      </div>

      {/* Slide-in panels */}
      {active === "equipment" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Add Equipment
          </h3>
          <AddEquipmentForm onClose={() => setActive(null)} />
        </div>
      )}

      {active === "issue" && (
        <div className="rounded-xl border border-red-200 bg-red-50/30 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Log Maintenance Issue
          </h3>
          <AddIssueForm equipment={equipment} onClose={() => setActive(null)} />
        </div>
      )}
    </div>
  );
}
