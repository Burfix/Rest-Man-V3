/**
 * services/micros/MicrosSyncService.ts -- stub.
 * Full sync implementation pending; auth flow is available via lib/micros/auth.
 */

export interface SyncResult {
  success:        boolean;
  message:        string;
  businessDate?:  string;
  recordsSynced?: number;
  errors?:        string[];
}

export class MicrosSyncService {
  async runFullSync(_date?: string): Promise<SyncResult> {
    return {
      success: false,
      message: "Data sync is not yet implemented. Authentication is available — sync logic is pending.",
    };
  }
}
