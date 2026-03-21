/**
 * services/micros/sync.ts -- stub: sync logic pending implementation.
 */

export interface SyncResult {
  success:       boolean;
  message:       string;
  businessDate?: string;
  recordsSynced?: number;
  errors?:       string[];
}

export async function runFullSync(_date?: string): Promise<SyncResult> {
  return {
    success: false,
    message: "Data sync is not yet implemented. Authentication is available — sync logic is pending.",
  };
}
