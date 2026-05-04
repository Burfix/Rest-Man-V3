#!/usr/bin/env tsx
/**
 * scripts/backfill-audit.ts
 *
 * ONE-TIME script: creates audit_logs entries for all existing dead_letter
 * jobs in sync_job_queue and async_job_queue.
 *
 * Run ONCE after deploying migration 079 and the audit logger.
 * Safe to re-run — idempotent because it checks for existing entries
 * by entity_id before inserting.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/backfill-audit.ts
 *
 *   Or with dotenv:
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-audit.ts
 */

import { createClient } from "@supabase/supabase-js";

// ── Env validation ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "    Run: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-audit.ts",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DeadLetterJob {
  id:          string;
  site_id:     string;
  sync_type?:  string;   // sync_job_queue
  job_type?:   string;   // async_job_queue
  attempts:    number;
  last_error:  string | null;
  created_at:  string;
  completed_at: string | null;
}

async function getExistingAuditEntityIds(): Promise<Set<string>> {
  const { data } = await db
    .from("audit_logs")
    .select("entity_id")
    .eq("action", "job.dead_lettered")
    .not("entity_id", "is", null);

  return new Set((data ?? []).map((r: { entity_id: string }) => r.entity_id));
}

async function backfillQueue(
  tableName: "sync_job_queue" | "async_job_queue",
  alreadyAudited: Set<string>,
): Promise<{ inserted: number; skipped: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from(tableName)
    .select("id, site_id, sync_type, job_type, attempts, last_error, created_at, completed_at")
    .eq("status", "dead_letter");

  if (error) {
    console.error(`  ❌  Failed to query ${tableName}: ${error.message}`);
    return { inserted: 0, skipped: 0 };
  }

  const jobs = (data ?? []) as DeadLetterJob[];
  let inserted = 0;
  let skipped  = 0;

  for (const job of jobs) {
    if (alreadyAudited.has(job.id)) {
      skipped++;
      continue;
    }

    const jobType = job.sync_type ?? job.job_type ?? "unknown";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = await (db as any).from("audit_logs").insert({
      site_id:      job.site_id,
      actor_type:   "system",
      actor_id:     "backfill-script",
      action:       "job.dead_lettered",
      entity_type:  tableName === "sync_job_queue" ? "sync_job" : "async_job",
      entity_id:    job.id,
      before_state: { status: "failed" },
      after_state:  { status: "dead_letter" },
      metadata: {
        job_type:      jobType,
        attempts:      job.attempts,
        last_error:    job.last_error ?? null,
        source_table:  tableName,
        backfilled_at: new Date().toISOString(),
      },
    });

    if (insertErr) {
      console.warn(`  ⚠️  Insert failed for job ${job.id}: ${insertErr.message}`);
    } else {
      inserted++;
      alreadyAudited.add(job.id); // prevent double-insert if id appears in both tables
    }
  }

  return { inserted, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ Backfill audit_logs: dead_letter jobs ═══\n");

  // Get IDs already audited (safe to re-run)
  console.log("Checking existing audit entries...");
  const alreadyAudited = await getExistingAuditEntityIds();
  console.log(`  Found ${alreadyAudited.size} already-audited job(s).\n`);

  // Backfill sync_job_queue
  console.log("Processing sync_job_queue...");
  const syncResult = await backfillQueue("sync_job_queue", alreadyAudited);
  console.log(`  Inserted: ${syncResult.inserted}  Skipped: ${syncResult.skipped}\n`);

  // Backfill async_job_queue
  console.log("Processing async_job_queue...");
  const asyncResult = await backfillQueue("async_job_queue", alreadyAudited);
  console.log(`  Inserted: ${asyncResult.inserted}  Skipped: ${asyncResult.skipped}\n`);

  const total = syncResult.inserted + asyncResult.inserted;
  console.log(`✅  Done. ${total} new audit entries created.\n`);
}

main().catch((err) => {
  console.error("❌  Backfill failed:", err);
  process.exit(1);
});
