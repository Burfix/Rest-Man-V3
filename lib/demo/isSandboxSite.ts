/**
 * Sandbox site detection.
 *
 * A site is considered the demo sandbox if:
 *   - store_code is 'TEST-01'
 *   - name contains 'Sandbox' (case-insensitive)
 *   - slug (if present) is 'sandbox'
 */

interface SandboxCheckInput {
  storeCode: string | null;
  siteName:  string;
  slug?:     string | null;
}

export function isSandboxSite(site: SandboxCheckInput): boolean {
  if (site.storeCode === "TEST-01") return true;
  if (site.siteName?.toLowerCase().includes("sandbox")) return true;
  if (site.slug && site.slug === "sandbox") return true;
  return false;
}
