/**
 * services/micros/auth.ts
 *
 * DEPRECATED — kept for import compatibility only.
 *
 * The active auth path is the password grant in lib/micros/auth.ts,
 * accessed through MicrosAuthService (services/micros/MicrosAuthService.ts).
 *
 * DO NOT add new callers.
 */

import { getMicrosAccessToken } from "@/lib/micros/auth";
import type { MicrosConnection } from "@/types/micros";

/**
 * @deprecated Use MicrosAuthService.getAccessToken() instead.
 */
export async function getMicrosToken(_connectionId: string): Promise<string> {
  return getMicrosAccessToken();
}

/**
 * @deprecated Use POST /api/micros/test-connection instead.
 */
export async function testMicrosAuth(_connection: MicrosConnection): Promise<string> {
  return getMicrosAccessToken();
}

