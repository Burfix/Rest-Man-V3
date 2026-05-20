/**
 * lib/sync/auth.ts
 *
 * HMAC-based cron authentication for the sync scheduler.
 *
 * Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
 *
 * Verification order:
 * 1. Check Authorization header against CRON_SECRET env var (fast path)
 * 2. Optionally compare against scheduler_auth_keys table (rotation support)
 *
 * Keys in scheduler_auth_keys are stored as SHA-256 hashes, never plaintext.
 * This means a stolen DB dump does not expose the active secret.
 */

import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createServerClient } from "@/lib/supabase/server";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Verify an incoming cron request.
 * Never leaks timing information about key existence.
 */
export async function verifyCronAuth(req: NextRequest): Promise<CronAuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or malformed Authorization header" };
  }

  const suppliedSecret = authHeader.slice("Bearer ".length);
  if (!suppliedSecret) {
    return { ok: false, error: "Empty bearer token" };
  }

  // Fast path: compare against CRON_SECRET env var
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && timingSafeCompare(suppliedSecret, envSecret)) {
    return { ok: true };
  }

  // DB path: compare SHA-256 hash against scheduler_auth_keys
  const suppliedHash = hashSecret(suppliedSecret);
  try {
    const supabase = createServerClient();
    // scheduler_auth_keys table added in migration 062 — cast until types are regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as unknown as { from: (t: string) => any };
    const { data, error } = await db
      .from("scheduler_auth_keys")
      .select("id, key_hash, expires_at, is_active")
      .eq("key_hash", suppliedHash)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      logger.warn("cron_auth.db_lookup_failed", { error: error.message });
      // Fall through to rejection — DB error ≠ auth bypass
    }

    if (data) {
      // Check expiry
      if (data.expires_at && new Date(data.expires_at as string) < new Date()) {
        logger.warn("cron_auth.key_expired", { key_id: data.id });
        return { ok: false, error: "Auth key has expired" };
      }
      return { ok: true };
    }
  } catch (err) {
    logger.error("cron_auth.exception", { err: String(err) });
  }

  logger.warn("cron_auth.rejected", { suppliedHashPrefix: suppliedHash.slice(0, 8) });
  return { ok: false, error: "Invalid or unknown cron secret" };
}

/**
 * Hash a secret for storage/comparison.
 * Stored hashes must NEVER be the raw secret.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Timing-safe string comparison.
 */
function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      // Length mismatch: still do a comparison to avoid timing leak
      timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
