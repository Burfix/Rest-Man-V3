/**
 * services/micros/auth.ts
 *
 * DEPRECATED — kept for import compatibility only.
 *
 * The active auth path is the PKCE flow in lib/micros/auth.ts,
 * accessed through MicrosAuthService (services/micros/MicrosAuthService.ts).
 *
 * This file previously used a client_credentials grant requiring
 * MICROS_CLIENT_SECRET, which is no longer part of the architecture.
 * All functions here now delegate to the PKCE-based token cache.
 *
 * DO NOT add new callers. Remove this file once services/micros/sync.ts
 * is fully migrated to MicrosSyncService.
 */

import { getMicrosIdToken } from "@/lib/micros/auth";
import type { MicrosConnection } from "@/types/micros";

/**
 * @deprecated Use MicrosAuthService.getAccessToken() instead.
 * Returns a valid Bearer token via the PKCE flow (ignores connectionId).
 */
export async function getMicrosToken(_connectionId: string): Promise<string> {
  return getMicrosIdToken();
}

/**
 * @deprecated Use POST /api/micros/test-connection instead.
 * Validates authentication by running the PKCE flow.
 */
export async function testMicrosAuth(_connection: MicrosConnection): Promise<string> {
  return getMicrosIdToken();
}

