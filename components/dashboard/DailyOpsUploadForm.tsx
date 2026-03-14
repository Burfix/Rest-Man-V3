"use client";

import { useState, useRef } from "react";
import { formatShortDate } from "@/lib/utils";

interface UploadResult {
  report: {
    id: string;
    report_date: string;
    sales_net_vat: number | null;
    margin_percent: number | null;
    labor_cost_percent: number | null;
    guest_count: number | null;
  };
  laborCount: number;
  revenueCenterCount: number;
  parseWarnings?: string[];
}

interface Props {
  onSuccess?: (result: UploadResult) => void;
}

export default function DailyOpsUploadForm({ onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reportDate, setReportDate] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "duplicate" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setMessage("Please select a CSV file."); return; }
    if (!reportDate) { setStatus("error"); setMessage("Please select the report date."); return; }

    setStatus("loading");
    setMessage("");
    setResult(null);
    setWarnings([]);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("report_date", reportDate);

    try {
      const res = await fetch("/api/daily-ops/upload", { method: "POST", body: fd });
      const json = await res.json();

      if (res.status === 201) {
        setStatus("success");
        setResult(json);
        setWarnings(json.parseWarnings ?? []);
        setMessage(`Report for ${formatShortDate(reportDate)} uploaded successfully.`);
        if (onSuccess) onSuccess(json);
        // Reset form
        if (fileRef.current) fileRef.current.value = "";
        setReportDate("");
      } else if (res.status === 409) {
        setStatus("duplicate");
        setMessage(`A report for ${formatShortDate(reportDate)} already exists.`);
      } else {
        setStatus("error");
        setMessage(json.error ?? "Upload failed.");
        setWarnings(json.parseWarnings ?? []);
      }
    } catch {
      setStatus("error");
      setMessage("Network error — please try again.");
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-stone-800">
        Upload Daily Operations Report
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">
            Report Date
          </label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            required
            className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">
            Toast CSV Export
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            required
            className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600 file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white file:cursor-pointer focus:outline-none"
          />
          <p className="mt-1 text-xs text-stone-400">
            Export from Toast: Reports → Daily Operations → Export CSV
          </p>
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
        >
          {status === "loading" ? "Uploading…" : "Upload Report"}
        </button>
      </form>

      {/* Status messages */}
      {status === "success" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">{message}</p>
          {result && (
            <ul className="mt-2 space-y-0.5 text-xs text-green-700">
              <li>Sales Net VAT: {result.report.sales_net_vat != null ? `R${result.report.sales_net_vat.toFixed(2)}` : "—"}</li>
              <li>Margin: {result.report.margin_percent != null ? `${result.report.margin_percent.toFixed(1)}%` : "—"}</li>
              <li>Labor %: {result.report.labor_cost_percent != null ? `${result.report.labor_cost_percent.toFixed(1)}%` : "—"}</li>
              <li>Guests: {result.report.guest_count ?? "—"}</li>
              <li>{result.laborCount} labor row{result.laborCount !== 1 ? "s" : ""}, {result.revenueCenterCount} revenue center{result.revenueCenterCount !== 1 ? "s" : ""} imported</li>
            </ul>
          )}
        </div>
      )}

      {status === "duplicate" && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Duplicate report</p>
          <p className="text-xs">{message}</p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">Upload failed</p>
          <p className="text-xs">{message}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">Parse warnings:</p>
          <ul className="mt-1 list-inside list-disc">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
