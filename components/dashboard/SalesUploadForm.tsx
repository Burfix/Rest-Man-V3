"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const WEEK_LABEL_PLACEHOLDER = "e.g. Week 10 — 3–9 Mar 2026";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; itemCount: number; weekLabel: string }
  | { status: "error"; message: string };

export default function SalesUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "uploading" });

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/sales/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        setState({ status: "error", message: json.error ?? "Upload failed." });
        return;
      }

      setState({
        status: "success",
        itemCount: json.itemCount as number,
        weekLabel: (formData.get("week_label") as string) ?? "",
      });

      form.reset();
      router.refresh();
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  function handleReset() {
    setState({ status: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  }

  const isUploading = state.status === "uploading";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">
        Upload Weekly Sales CSV
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Required columns:{" "}
        <span className="font-mono">item_name, quantity_sold, sales_amount</span>
        . Optional:{" "}
        <span className="font-mono">category, unit_price</span>.
      </p>

      {/* Success banner */}
      {state.status === "success" && (
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4">
          <svg
            className="h-5 w-5 text-green-600 mt-0.5 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800">
              Upload successful
            </p>
            <p className="text-xs text-green-700 mt-0.5">
              {state.itemCount} item{state.itemCount === 1 ? "" : "s"} imported
              for{" "}
              <span className="font-medium">{state.weekLabel}</span>. The table
              below has been refreshed.
            </p>
          </div>
          <button
            onClick={handleReset}
            className="text-green-500 hover:text-green-700 text-xs underline shrink-0"
          >
            Upload another
          </button>
        </div>
      )}

      {/* Error banner */}
      {state.status === "error" && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <svg
            className="h-5 w-5 text-red-500 mt-0.5 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700">Upload failed</p>
            <p className="text-xs text-red-600 mt-0.5">{state.message}</p>
          </div>
          <button
            onClick={handleReset}
            className="text-red-500 hover:text-red-700 text-xs underline shrink-0"
          >
            Try again
          </button>
        </div>
      )}

      {/* Form (hide after success until "Upload another") */}
      {state.status !== "success" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File input */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              CSV file <span className="text-red-500">*</span>
            </label>
            <input
              ref={fileRef}
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={isUploading}
              className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50 disabled:opacity-50"
            />
          </div>

          {/* Week label */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Week label <span className="text-red-500">*</span>
            </label>
            <input
              name="week_label"
              type="text"
              placeholder={WEEK_LABEL_PLACEHOLDER}
              required
              disabled={isUploading}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            />
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Week start <span className="text-red-500">*</span>
              </label>
              <input
                name="week_start"
                type="date"
                required
                disabled={isUploading}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Week end <span className="text-red-500">*</span>
              </label>
              <input
                name="week_end"
                type="date"
                required
                disabled={isUploading}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isUploading}
            className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"
                  />
                </svg>
                Uploading…
              </>
            ) : (
              "Upload CSV"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
