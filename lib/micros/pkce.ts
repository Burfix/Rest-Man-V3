/**
 * lib/micros/pkce.ts
 *
 * PKCE (Proof Key for Code Exchange) helpers — RFC 7636.
 *
 * Used by the Oracle MICROS BI API auth flow:
 *   1. generateCodeVerifier()  — random high-entropy secret
 *   2. generateCodeChallenge() — BASE64URL(SHA-256(verifier))
 *
 * SERVER-SIDE ONLY.  Never import in client components.
 */

import crypto from "crypto";

/**
 * Generates a cryptographically random code_verifier.
 *
 * RFC 7636 §4.1: 43–128 chars from [A-Z a-z 0-9 - . _ ~]
 * We use 64 random bytes → 86-char base64url string (well within range).
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url");
}

/**
 * Derives the code_challenge from a code_verifier.
 *
 * code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))  — RFC 7636 §4.2
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier, "ascii").digest();
  // Buffer → base64url (replace +→-, /→_, strip =)
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
