"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; count: number; from: string; to: string }
  | { status: "error"; message: string };

export default function HistoricalSalesUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "uploading" });

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/sales/historical/upload", {
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
        count: json.count as number,
        from: json.dateRange?.from ?? "",
        to: json.dateRange?.to ?? "",
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
    <div className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="mb-1 text-sm font-semibold text-stone-900">
        Upload Historical Sales CSV
      </h2>
      <p className="mb-4 text-xs text-stone-500">
        Required columns:{" "}
        <span className="font-mono">date</span> (or{" "}
        <span className="font-mono">Business Date</span>) and{" "}
        <span className="font-mono">gross_sales</span> (or{" "}
        <span className="font-mono">Gross Sales</span> /{" "}
        <span className="font-mono">Net Sales</span>). One row per day.
        Re-uploading the same date overwrites the previous value.
      </p>

      {/* Success banner */}
      {state.status === "success" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-green-600"
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
            <p className="text-sm font-medium text-green-800">Upload successful</p>
            <p className="mt-0.5 text-xs text-green-700">
              {state.count} day{state.count === 1 ? "" : "s"} saved
              {state.from && state.to && (
                <>
                  {" "}
                  · {state.from} to {state.to}
                </>
              )}
              . Re-uploads overwrite existing values.
            </p>
          </div>
          <button
            onClick={handleReset}
            className="shrink-0 text-xs text-green-500 underline hover:text-green-700"
          >
            Upload another
          </button>
        </div>
      )}

      {/* Error banner */}
      {state.status === "error" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-red-500"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Upload failed</p>
            <p className="mt-0.5 text-xs text-red-600">{state.message}</p>
          </div>
          <button
            onClick={handleReset}
            className="shrink-0 text-xs text-red-500 underline hover:text-red-700"
          >
            Try again
          </button>
        </div>
      )}

      {state.status !== "success" && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-stone-700">
              CSV File
            </label>
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              disabled={isUploading}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 file:mr-4 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700 hover:file:bg-stone-200 disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={isUploading}
            className="shrink-0 rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {isUploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      )}
    </div>
  );
}
