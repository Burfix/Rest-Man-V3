/**
 * services/micros/sync.ts -- stub: data sync is not available.
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
    message: "Data sync is not available. The Oracle MICROS connection method has not yet been confirmed.",
  };
}
