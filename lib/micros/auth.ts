/**
 * lib/micros/auth.ts
 *
 * Authentication stub — no auth flow is active.
 * All connection attempts are blocked until Oracle confirms the supported
 * authentication method for this integration.
 */

export type MicrosAuthMode = "unknown" | "password";

export interface OracleTokenSet {
  accessToken:       string;
  idToken?:          string;
  refreshToken?:     string;
  expiresAt:         number;
  refreshExpiresAt?: number;
}

export class MicrosAuthError extends Error {
  constructor(
    public readonly stage:       "token" | "refresh" | "config",
    public readonly userMessage: string,
    public readonly detail?:     string,
    public readonly reasonCode?: string,
  ) {
    super(
      `[MicrosAuth:${stage}] ${userMessage}` +
        (detail ? ` -- ${detail}` : ""),
    );
    this.name = "MicrosAuthError";
  }
}

/** Always returns "unknown" — no auth mode is confirmed. */
export function getAuthMode(): MicrosAuthMode {
  return "unknown";
}

/** No-op — no token exists while auth flow is unconfirmed. */
export function clearMicrosTokenCache(): void {}

export function getMicrosTokenStatus() {
  return {
    valid:            false,
    expiresAt:        null as number | null,
    hasRefreshToken:  false,
    refreshExpiresAt: null as number | null,
  };
}

/** Throws — no auth flow is active. */
export async function getMicrosAccessToken(): Promise<string> {
  throw new MicrosAuthError(
    "config",
    "Authentication is not configured.",
    "No Oracle-supported connection method has been confirmed.",
    "AUTH_NOT_CONFIGURED",
  );
}
