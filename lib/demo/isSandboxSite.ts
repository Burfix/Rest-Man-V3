/**
 * Sandbox site detection.
 *
 * A site is considered the demo sandbox if:
 *   - store_code matches SANDBOX_STORE_CODE (see lib/demo/sandbox-config.ts)
 *   - name contains 'Sandbox' (case-insensitive)
 *   - slug (if present) is 'sandbox'
 *
 * RULE: Do not hardcode "TEST-01" here or elsewhere. Use SANDBOX_STORE_CODE.
 */

import { SANDBOX_STORE_CODE } from "./sandbox-config";

interface SandboxCheckInput {
  storeCode: string | null;
  siteName:  string;
  slug?:     string | null;
}

export function isSandboxSite(site: SandboxCheckInput): boolean {
  if (site.storeCode === SANDBOX_STORE_CODE) return true;
  if (site.siteName?.toLowerCase().includes("sandbox")) return true;
  if (site.slug && site.slug === "sandbox") return true;
  return false;
}
