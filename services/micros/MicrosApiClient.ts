/**
 * services/micros/MicrosApiClient.ts -- stub.
 */
import { MicrosAuthError } from "@/lib/micros/auth";

export { MicrosAuthError };

class MicrosApiClientImpl {
  async get<T = unknown>(path: string): Promise<T> {
    const { MicrosApiClient: client } = await import("@/lib/micros/client");
    return client.get<T>(path);
  }
}

export const MicrosApiClient = new MicrosApiClientImpl();
