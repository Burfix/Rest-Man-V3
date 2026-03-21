/**
 * services/micros/MicrosSyncService.ts -- stub.
 * Data sync is not available until the Oracle connection method is confirmed.
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
      message: "Data sync is not available. The Oracle MICROS connection method has not yet been confirmed.",
    };
  }
}
