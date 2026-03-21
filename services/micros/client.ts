/**
 * services/micros/client.ts -- stub: no auth flow active.
 */

export async function microsGet<T = unknown>(
  _opts: {
    connectionId: string;
    appServerUrl: string;
    orgIdentifier: string;
    locRef: string;
    path: string;
    params?: Record<string, string>;
  }
): Promise<T> {
  throw new Error("MICROS API client is not available. The Oracle connection method has not been confirmed.");
}
