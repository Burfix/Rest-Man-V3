/**
 * services/micros/MicrosAuthService.ts -- stub.
 */

class MicrosAuthServiceImpl {
  async getAccessToken(): Promise<string> {
    const { getMicrosIdToken } = await import("@/lib/micros/auth");
    return getMicrosIdToken();
  }
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.getAccessToken();
      return { ok: true, message: "PKCE authentication successful." };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Authentication failed.",
      };
    }
  }
}

export const MicrosAuthService = new MicrosAuthServiceImpl();
