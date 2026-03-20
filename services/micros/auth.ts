/**
 * services/micros/auth.ts
 *
 * Oracle MICROS OAuth — client credentials flow.
 *
 * The client secret is read from env var MICROS_CLIENT_SECRET.
 * The access token is cached in the micros_connections row and refreshed
 * when it has fewer than 5 minutes remaining.
 *
 * NEVER expose the token or secret to client-side code.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { _OracleTokenResponse, MicrosConnection } from "@/types/micros";

const TOKEN_BUFFER_SECS = 300; // refresh 5 min before expiry

/**
 * Returns a valid bearer token for the given connection.
 * Reads the cached token from the DB; fetches a new one if missing or expiring.
 */
export async function getMicrosToken(connectionId: string): Promise<string> {
  const supabase = createServerClient();

  // Fetch the full row including token fields
  const { data, error } = await supabase
    .from("micros_connections")
    .select("id, client_id, auth_server_url, org_identifier, access_token, token_expires_at")
    .eq("id", connectionId)
    .single();

  if (error || !data) {
    throw new Error(`MICROS connection not found: ${connectionId}`);
  }

  const row = data as {
    id: string;
    client_id: string;
    auth_server_url: string;
    org_identifier: string;
    access_token: string | null;
    token_expires_at: string | null;
  };

  // Check if cached token is still valid
  if (row.access_token && row.token_expires_at) {
    const expiresAt = new Date(row.token_expires_at).getTime();
    if (expiresAt - Date.now() > TOKEN_BUFFER_SECS * 1000) {
      return row.access_token;
    }
  }

  // Fetch a fresh token
  const clientSecret = process.env.MICROS_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("MICROS_CLIENT_SECRET environment variable is not set.");
  }

  const token = await fetchNewToken(
    row.auth_server_url,
    row.client_id,
    clientSecret,
    row.org_identifier,
  );

  // Cache it in DB
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  await supabase
    .from("micros_connections")
    .update({ access_token: token.access_token, token_expires_at: expiresAt })
    .eq("id", connectionId);

  return token.access_token;
}

/**
 * Performs the OAuth client_credentials token request against Oracle Identity Cloud.
 * @internal
 */
/** Correct Oracle MSAF OIDC token endpoint path. */
const ORACLE_TOKEN_PATH = "/oidc-provider/v1/oauth2/token";

async function fetchNewToken(
  authServerUrl: string,
  clientId: string,
  clientSecret: string,
  orgIdentifier: string,
): Promise<_OracleTokenResponse> {
  const tokenUrl = `${authServerUrl.replace(/\/$/, "")}${ORACLE_TOKEN_PATH}`;

  // Guard: catch any accidental regression to the wrong legacy path.
  if (tokenUrl.includes("/oauth2/v1/token") && !tokenUrl.includes("/oidc-provider/")) {
    console.warn(
      "[MicrosAuth legacy] WARNING: tokenUrl looks like the wrong Oracle path.\n" +
      `  Resolved: ${tokenUrl}\n` +
      `  Expected path: ${ORACLE_TOKEN_PATH}\n` +
      "  Check MICROS_AUTH_SERVER — it should NOT already contain the token path.",
    );
  }

  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         orgIdentifier ? `${orgIdentifier}.micros` : "micros",
  });

  const res = await fetch(tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MICROS auth failed (${res.status}): ${text}`);
  }

  const json = await res.json() as _OracleTokenResponse;
  if (!json.access_token) {
    throw new Error("MICROS auth response missing access_token.");
  }

  return json;
}

/**
 * Validates that a connection can successfully authenticate.
 * Returns the token on success, throws on failure.
 */
export async function testMicrosAuth(connection: MicrosConnection): Promise<string> {
  const clientSecret = process.env.MICROS_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("MICROS_CLIENT_SECRET environment variable is not set.");
  }
  const token = await fetchNewToken(
    connection.auth_server_url,
    connection.client_id,
    clientSecret,
    connection.org_identifier,
  );
  return token.access_token;
}
