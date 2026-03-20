/**
 * services/micros/MicrosAuthService.ts
 *
 * Thin wrapper around lib/micros/auth.ts (PKCE flow).
 * Keeps the same public API so MicrosApiClient and sync routes work unchanged.
 */

import {
  getMicrosIdToken,
  clearMicrosTokenCache,
  getMicrosTokenStatus,
} from "@/lib/micros/auth";

class MicrosAuthServiceImpl {
  /** Returns a valid Bearer id_token via the PKCE flow. */
  async getAccessToken(): Promise<string> {
    return getMicrosIdToken();
  }

  /** Forces a fresh token acquisition (clears cache, then re-authenticates). */
  async refreshAccessToken(): Promise<string> {
    clearMicrosTokenCache();
    return getMicrosIdToken();
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
