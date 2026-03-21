/**
 * services/micros/MicrosAuthService.ts -- stub.
 */

class MicrosAuthServiceImpl {
  async getAccessToken(): Promise<string> {
    throw new Error("MICROS authentication is not configured.");
  }
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: false,
      message: "No connection test has been run because the exact Oracle-supported authentication method has not yet been confirmed.",
    };
  }
}

export const MicrosAuthService = new MicrosAuthServiceImpl();
