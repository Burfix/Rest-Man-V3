/**
 * services/micros/MicrosLabourService.ts -- stub.
 */

export interface DailyLabourSummary {
  date:            string;
  totalHours:      number;
  regularHours:    number;
  overtimeHours:   number;
  employeeCount:   number;
}

export class MicrosLabourService {
  async getDailySummary(_date: string): Promise<DailyLabourSummary | null> {
    return null;
  }
  async getTimecards(_date: string): Promise<unknown[]> {
    return [];
  }
}
