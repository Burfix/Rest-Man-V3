/**
 * lib/micros/client.ts -- stub: no auth flow active.
 * The Oracle MICROS connection method has not yet been confirmed.
 */

export { MicrosAuthError } from "./auth";

export const MicrosApiClient = {
  get: async (_path: string, _params?: Record<string, string>): Promise<never> => {
    throw new Error(
      "MICROS API client is not available. The Oracle connection method has not been confirmed.",
    );
  },
};
