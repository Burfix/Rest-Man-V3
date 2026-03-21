/**
 * services/micros/auth.ts -- stub: import compatibility only.
 * No authentication is performed.
 */

export async function getMicrosToken(_connectionId: string): Promise<string> {
  throw new Error("MICROS authentication is not configured.");
}

export async function testMicrosAuth(_connection: unknown): Promise<string> {
  throw new Error("MICROS authentication is not configured.");
}
