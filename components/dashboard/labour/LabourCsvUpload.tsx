/**
 * components/dashboard/labour/LabourCsvUpload.tsx
 *
 * Manual CSV upload fallback for labour data.
 */
"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

export default function LabourCsvUpload() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/micros/labour-upload", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      setResult({ ok: json.ok, message: json.message });
      if (json.ok) {
        // Clear file input
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-300">
          Manual CSV Upload
        </span>
        <span className="text-stone-500 dark:text-stone-400 text-xs">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Upload a CSV with columns: <code className="bg-stone-100 dark:bg-stone-800 px-1 rounded">empNum, jobCode, businessDate, clockIn, clockOut, regHrs, regPay, ovtHrs, ovtPay</code>
          </p>

          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="text-xs text-stone-600 dark:text-stone-400 file:mr-2 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-stone-700 dark:file:text-stone-300"
            />
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="rounded-md bg-stone-800 dark:bg-stone-200 px-3 py-1.5 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50 transition-colors"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>

          {result && (
            <p
              className={cn(
                "text-xs font-medium",
                result.ok
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {result.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
