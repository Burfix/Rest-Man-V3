/**
 * services/micros/sync.ts — convenience wrapper around MicrosSyncService.
 *
 * NOTE: All sync operations require explicit tenant context.
 * Never call runFullSync() without siteId + organisationId + microsLocationRef.
 */

import { MicrosSyncService } from "./MicrosSyncService";
import type { MicrosSyncContext } from "./MicrosSyncService";

export type { SyncResult, MicrosSyncContext } from "./MicrosSyncService";

export async function runFullSync(context: MicrosSyncContext, date?: string) {
  const svc = new MicrosSyncService();
  return svc.runFullSync(context, date);
}
