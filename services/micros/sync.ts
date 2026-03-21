/**
 * services/micros/sync.ts — convenience wrapper around MicrosSyncService.
 */

import { MicrosSyncService } from "./MicrosSyncService";

export type { SyncResult } from "./MicrosSyncService";

export async function runFullSync(date?: string) {
  const svc = new MicrosSyncService();
  return svc.runFullSync(date);
}
