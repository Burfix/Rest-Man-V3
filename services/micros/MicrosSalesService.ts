/**
 * services/micros/MicrosSalesService.ts -- stub.
 */
import type { MicrosSalesDaily } from "@/types/micros";

export class MicrosSalesService {
  async getDailyTotals(_date: string): Promise<MicrosSalesDaily | null> {
    return null;
  }
  async getIntervals(_date: string): Promise<unknown[]> {
    return [];
  }
  async getGuestChecks(_date: string): Promise<unknown[]> {
    return [];
  }
}
