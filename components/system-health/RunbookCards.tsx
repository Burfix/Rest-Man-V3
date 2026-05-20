"use client";

import { useState } from "react";

interface RunbookEntry {
  id: string;
  title: string;
  icon: string;
  symptoms: string[];
  likelyCause: string;
  recoverySteps: string[];
  fallback: string;
  escalationOwner: string;
}

const RUNBOOKS: RunbookEntry[] = [
  {
    id: "micros_not_syncing",
    title: "MICROS data not syncing",
    icon: "🔌",
    symptoms: [
      "Sales data shows as stale or delayed",
      "Labour data missing from dashboard",
      "Data freshness score declining",
      "Data degraded warning on Command Center",
    ],
    likelyCause: "MICROS POS connection dropped, credentials rotated, or server URL changed.",
    recoverySteps: [
      "Go to Integrations and click Sync Sales",
      "Check the last successful sync timestamp",
      "Verify MICROS credentials are correct in Settings → Integrations",
      "If syncing, wait 3 minutes for the scheduler to complete",
      "Check Jobs health for failure details",
      "If still failing, check the last error message in MICROS Integration Health",
    ],
    fallback: "System continues using last known data. Scores reflect the last successful sync.",
    escalationOwner: "Technical Operator",
  },
  {
    id: "data_stale_3h",
    title: "Data stale > 3 hours",
    icon: "⏱️",
    symptoms: [
      "Data age shows > 3h in Data Source Health",
      "Status shows 'Stale' or 'Missing'",
      "Voice line references old data",
      "Score card shows 'Using last known data'",
    ],
    likelyCause: "Sync job failed silently, MICROS server unreachable, or scheduler not running.",
    recoverySteps: [
      "Check Jobs & Cron Health — look for failed jobs",
      "Click 'Run now' for the relevant sync job",
      "Check if the scheduler tick is running: GET /api/health",
      "If scheduler is not ticking, check Vercel cron configuration",
      "Verify MICROS server is online and reachable",
    ],
    fallback: "Dashboard displays last known data with a freshness warning. No data is lost.",
    escalationOwner: "Technical Operator",
  },
  {
    id: "user_no_access",
    title: "User cannot access store",
    icon: "🔒",
    symptoms: [
      "User sees 'Access Restricted' page",
      "User cannot see dashboard data",
      "User redirected to login loop",
    ],
    likelyCause: "User role not assigned, site not linked to user, or session expired.",
    recoverySteps: [
      "Go to Admin → Users and verify the user's role",
      "Check that the user is assigned to the correct site",
      "Ask the user to sign out and sign back in",
      "Verify the user's email is confirmed in Supabase Auth",
      "Check user_roles table for is_active=true and revoked_at IS NULL",
    ],
    fallback: "User is shown a clear access restricted page with a support contact.",
    escalationOwner: "Head Office Admin",
  },
  {
    id: "auth_errors",
    title: "401 / 403 auth errors",
    icon: "🛡️",
    symptoms: [
      "API calls returning 401 or 403",
      "Dashboard data not loading",
      "Intermittent auth failures",
    ],
    likelyCause: "JWT expired, SUPABASE_SERVICE_ROLE_KEY invalid, or permission not assigned to role.",
    recoverySteps: [
      "Check Vercel environment variables — ensure all Supabase keys are set",
      "Verify NEXT_PUBLIC_SUPABASE_URL has no trailing whitespace or newlines",
      "Check SUPABASE_SERVICE_ROLE_KEY is the service role key (not anon key)",
      "Confirm the user's role has the required permission in lib/permissions.ts",
      "Check Sentry for the specific route and permission that failed",
    ],
    fallback: "User is redirected to login. No data exposure occurs on 401/403.",
    escalationOwner: "Technical Operator",
  },
  {
    id: "db_error",
    title: "Supabase / database error",
    icon: "🗄️",
    symptoms: [
      "GET /api/health returns status: unhealthy",
      "database: error in health check",
      "Dashboard shows blank or error state",
      "Multiple API routes failing simultaneously",
    ],
    likelyCause: "Supabase project paused (free tier inactivity), connection pool exhausted, or migration failed.",
    recoverySteps: [
      "Check GET /api/health response for database: error",
      "Visit your Supabase project dashboard — check if it's paused",
      "If paused, click 'Restore' in Supabase dashboard",
      "Check connection pool usage in Supabase monitoring",
      "Review recent migrations for syntax errors",
      "Check Vercel logs for connection timeout errors",
    ],
    fallback: "App will show degraded state. No writes occur during DB outage.",
    escalationOwner: "Supabase Project Owner",
  },
  {
    id: "action_system",
    title: "Action system not updating",
    icon: "⚡",
    symptoms: [
      "Priority actions not changing between sessions",
      "Completed actions still showing as open",
      "Action count not matching dashboard",
    ],
    likelyCause: "Brain cache not invalidating after action completion, or brain recompute not triggering.",
    recoverySteps: [
      "Wait for the 5-minute brain cache TTL to expire",
      "Trigger a manual sync to force cache invalidation",
      "Check if the action was saved correctly in the DB",
      "If actions API is returning stale data, check Redis cache in System Health",
      "Force a full recompute by clearing the Redis cache for this site",
    ],
    fallback: "Actions are always read from DB on cache miss. Stale state resolves within 10 minutes.",
    escalationOwner: "Technical Operator",
  },
  {
    id: "cron_failed",
    title: "Cron job failed",
    icon: "⏰",
    symptoms: [
      "Jobs show 'Failed' status in Jobs health",
      "Last run timestamp not updating",
      "Failed jobs count > 0 in Overview",
    ],
    likelyCause: "Vercel cron budget exceeded, CRON_SECRET mismatch, or job timed out (> 60s).",
    recoverySteps: [
      "Check Jobs & Cron Health for specific failure",
      "Use 'Run now' to manually trigger the job",
      "Check Vercel logs for the cron function execution",
      "Verify CRON_SECRET is set in Vercel environment variables",
      "If job times out, check for N+1 queries or slow Supabase queries",
      "Check Vercel cron quota for the project",
    ],
    fallback: "Scheduler is self-healing — failed jobs retry up to 3 times before dead-letter.",
    escalationOwner: "Technical Operator",
  },
  {
    id: "reviews_not_connected",
    title: "Reviews not connected",
    icon: "⭐",
    symptoms: [
      "Reviews data source shows 'Not configured'",
      "No review data on dashboard",
      "Review score missing from brain output",
    ],
    likelyCause: "Google Places API key not set, or place_id not configured for this site.",
    recoverySteps: [
      "Check Settings → Integrations for Google Places configuration",
      "Verify GOOGLE_PLACES_API_KEY is set in Vercel environment variables",
      "Confirm the site's place_id is configured in the sites table",
      "Trigger a manual reviews sync from Integrations page",
    ],
    fallback: "Reviews module is excluded from operating score calculation when not connected.",
    escalationOwner: "Head Office Admin",
  },
];

function RunbookCard({ runbook }: { runbook: RunbookEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{runbook.icon}</span>
          <span className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
            {runbook.title}
          </span>
        </div>
        <span className="text-zinc-400 ml-2 flex-shrink-0">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
          {/* Symptoms */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Symptoms</p>
            <ul className="space-y-1">
              {runbook.symptoms.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="text-zinc-400 mt-0.5">·</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Likely cause */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Likely cause</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{runbook.likelyCause}</p>
          </div>

          {/* Recovery steps */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Recovery steps</p>
            <ol className="space-y-1">
              {runbook.recoverySteps.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Fallback + escalation */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Expected fallback</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{runbook.fallback}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Escalation owner</p>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{runbook.escalationOwner}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RunbookCards() {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Runbook &amp; Recovery Steps
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Expand a scenario for step-by-step recovery guidance.
          </p>
        </div>
      </div>
      {RUNBOOKS.map(rb => (
        <RunbookCard key={rb.id} runbook={rb} />
      ))}
    </section>
  );
}
