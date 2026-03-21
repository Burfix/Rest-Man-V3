/**
 * services/micros/client.ts -- delegates to lib/micros/client.
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
  const { MicrosApiClient } = await import("@/lib/micros/client");
  return MicrosApiClient.get<T>(_opts.path);
}
