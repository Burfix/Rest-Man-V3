/**
 * services/micros/MicrosApiClient.ts -- stub.
 */
import { MicrosAuthError } from "@/lib/micros/auth";

export { MicrosAuthError };

class MicrosApiClientImpl {
  async get<T = unknown>(_path: string, _params?: Record<string, string>): Promise<T> {
    throw new Error("MICROS API client is not available. The Oracle connection method has not been confirmed.");
  }
}

export const MicrosApiClient = new MicrosApiClientImpl();
