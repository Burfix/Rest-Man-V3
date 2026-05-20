import type { ErrorHealth } from "@/lib/system-health/types";

interface ErrorMonitoringCardProps {
  errors: ErrorHealth;
}

function MetricRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`text-sm font-semibold ${accent ?? "text-zinc-800 dark:text-zinc-200"}`}>
        {value}
      </span>
    </div>
  );
}

export default function ErrorMonitoringCard({ errors }: ErrorMonitoringCardProps) {
  if (!errors.sentryConfigured) {
    return (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Error Monitoring</h2>
        </div>
        <div className="px-6 py-8 text-center space-y-3">
          <div className="text-3xl">🔌</div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Sentry not connected</p>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Connect a Sentry DSN in your environment variables to display live error metrics,
            exception rates, and route failure tracking.
          </p>
          <div className="mt-4 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-3 text-left">
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              NEXT_PUBLIC_SENTRY_DSN=https://...
            </p>
          </div>
        </div>
      </section>
    );
  }

  const syncFailAccent =
    errors.syncFailures24h === 0
      ? "text-emerald-600 dark:text-emerald-400"
      : errors.syncFailures24h >= 5
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";

  const deadLetterAccent =
    errors.deadLetterJobs === 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Error Monitoring</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Sync failures and dead-letter jobs.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Sentry connected
          </span>
        </div>
      </div>

      <div className="px-6 py-4">
        <MetricRow
          label="Sync failures (24h)"
          value={errors.syncFailures24h}
          accent={syncFailAccent}
        />
        <MetricRow
          label="Dead-letter jobs"
          value={errors.deadLetterJobs}
          accent={deadLetterAccent}
        />
        <MetricRow
          label="Sentry project"
          value="Connected"
          accent="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {errors.lastException && (
        <div className="mx-6 mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3">
          <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Last exception</p>
          <p className="font-mono text-xs text-red-600 dark:text-red-400 break-all line-clamp-3">
            {errors.lastException}
          </p>
        </div>
      )}
    </section>
  );
}
