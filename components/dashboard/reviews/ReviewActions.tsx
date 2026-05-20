"use client";

import { useState } from "react";
import AddReviewForm from "./AddReviewForm";

export default function ReviewActions() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          Add Review
        </button>
      )}

      {open && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Log Customer Review
          </h3>
          <AddReviewForm onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
