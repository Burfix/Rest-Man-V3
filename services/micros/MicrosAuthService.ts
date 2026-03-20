/**
 * services/micros/MicrosAuthService.ts
 *
 * Thin wrapper around lib/micros/auth.ts (password grant flow).
 * Keeps the same public API so MicrosApiClient and sync routes work unchanged.
 */

import {
  getMicrosAccessToken,
  clearMicrosTokenCache,
  getMicrosTokenStatus,
} from "@/lib/micros/auth";

class MicrosAuthServiceImpl {
  /** Returns a valid Bearer access_token via the password grant flow. */
  async getAccessToken(): Promise<string> {
    return getMicrosAccessToken();
  }

  /** Forces a fresh token acquisition (clears cache, then re-authenticates). */
  async refreshAccessToken(): Promise<string> {
    clearMicrosTokenCache();
    return getMicrosAccessToken();
  }

  isTokenValid(): boolean {
    return getMicrosTokenStatus().valid;
  }

  clearCache(): void {
    clearMicrosTokenCache();
  }

  getTokenStatus(): {
    valid: boolean;
    expiresAt: number | null;
    hasRefreshToken: boolean;
  } {
    const s = getMicrosTokenStatus();
    return {
      valid:           s.valid,
      expiresAt:       s.expiresAt,
      hasRefreshToken: s.hasRefreshToken,
    };
  }
}

export const MicrosAuthService = new MicrosAuthServiceImpl();
