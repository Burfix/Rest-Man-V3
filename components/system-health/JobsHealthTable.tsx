"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import type { JobHealth } from "@/lib/system-health/types";

interface JobsHealthTableProps {
  jobs: JobHealth[];
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)   return "< 1 min ago";
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return new Date(iso).toLocaleString("en-ZA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNext(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0)  return "Overdue";
  if (mins < 60)  return `in ${mins} min`;
  return `in ${Math.floor(mins / 60)}h`;
}

function RunNowButton({ jobType }: { jobType: string }) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch("/api/system-health/jobs/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ jobType }),
      });
      if (!res.ok) throw new Error("failed");
      setState("success");
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  if (state === "success") {
    return <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Queued ✓</span>;
  }
  if (state === "error") {
    return <span className="text-xs text-red-500">Failed</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className="rounded px-2.5 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
    >
      {state === "loading" ? "…" : "Run now"}
    </button>
  );
}

export default function JobsHealthTable({ jobs }: JobsHealthTableProps) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Jobs &amp; Cron Health
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Scheduled sync jobs. &ldquo;Run now&rdquo; queues the job for the next scheduler tick.
        </p>
      </div>

      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Job</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Last Run</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Next Run</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 uppercase tracking-wide">Failures</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 uppercase tracking-wide">Attempts</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {jobs.map(job => (
              <tr key={job.jobType} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                <td className="px-6 py-3">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{job.label}</span>
                  <span className="ml-2 font-mono text-xs text-zinc-400">{job.jobType}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatTs(job.lastRun)}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatNext(job.nextRun)}
                </td>
                <td className="px-4 py-3 text-center">
                  {job.failureCount > 0 ? (
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">{job.failureCount}</span>
                  ) : (
                    <span className="text-xs text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-xs text-zinc-400">
                  {job.attemptCount}
                </td>
                <td className="px-6 py-3">
                  {job.canRunNow ? (
                    <RunNowButton jobType={job.jobType} />
                  ) : (
                    <span className="text-xs text-zinc-400">Auto</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {jobs.map(job => (
          <div key={job.jobType} className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">{job.label}</span>
              <StatusBadge status={job.status} />
            </div>
            <div className="flex gap-4 text-xs text-zinc-500">
              <span>Last: {formatTs(job.lastRun)}</span>
              <span>Next: {formatNext(job.nextRun)}</span>
            </div>
            {job.failureCount > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">{job.failureCount} failure{job.failureCount !== 1 ? "s" : ""} in last 24h</p>
            )}
            {job.canRunNow && <RunNowButton jobType={job.jobType} />}
          </div>
        ))}
      </div>
    </section>
  );
}
