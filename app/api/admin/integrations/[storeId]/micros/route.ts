/**
 * PUT  /api/admin/integrations/[storeId]/micros — Save/update Micros credentials for a store
 * POST /api/admin/integrations/[storeId]/micros — Test connection with provided credentials
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

export const dynamic = "force-dynamic";

// ── Encryption helpers (AES-256-GCM) ──────────────────────────────────────

const ENCRYPTION_KEY_ENV = "MICROS_ENCRYPTION_KEY"; // 32-byte hex key in env

function getEncryptionKey(): Buffer {
  const hex = process.env[ENCRYPTION_KEY_ENV];
  if (!hex || hex.length < 32) {
    throw new Error(`${ENCRYPTION_KEY_ENV} env var must be set (min 32 hex chars)`);
  }
  // Derive a deterministic 32-byte key from the env var
  return createHash("sha256").update(hex).digest();
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + encrypted)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ── PUT — Save credentials ────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: { storeId: string } },
) {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "PUT /api/admin/integrations/[storeId]/micros");
  if (guard.error) return guard.error;
  const { supabase } = guard;
  const storeId = params.storeId;

  try {
    const body = await req.json();
    const {
      auth_server_url: authServerUrl,
      app_server_url: appServerUrl,
      client_id: clientId,
      org_identifier: orgIdentifier,
      loc_ref: locRef,
      username,
      password,
      location_name: locationName,
    } = body as {
      auth_server_url?: string; app_server_url?: string; client_id?: string;
      org_identifier?: string; loc_ref?: string; username?: string;
      password?: string; location_name?: string;
    };

    // Validate required fields
    if (!authServerUrl || !appServerUrl || !clientId || !orgIdentifier || !locRef || !username || !password) {
      return NextResponse.json(
        { error: "All credential fields are required" },
        { status: 400 },
      );
    }

    // Verify the store exists
    const { data: store } = await supabase
      .from("sites")
      .select("id, name")
      .eq("id", storeId)
      .maybeSingle();

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    // Encrypt the password
    let encryptedPassword: string;
    try {
      encryptedPassword = encrypt(password);
    } catch (err) {
      logger.error("Encryption failed — check MICROS_ENCRYPTION_KEY", { err });
      return NextResponse.json(
        { error: "Server encryption not configured. Contact admin." },
        { status: 500 },
      );
    }

    // Upsert the connection row (one per store)
    const upsertData = {
      site_id: storeId,
      auth_server_url: authServerUrl.replace(/\/+$/, ""),
      app_server_url: appServerUrl.replace(/\/+$/, ""),
      client_id: clientId,
      org_identifier: orgIdentifier,
      loc_ref: locRef,
      username,
      encrypted_password: encryptedPassword,
      location_name: locationName || (store as any).name,
      api_account_name: username,
      status: "awaiting_setup",
      updated_at: new Date().toISOString(),
    };

    // Check for existing connection for this store
    const { data: existing } = await supabase
      .from("micros_connections")
      .select("id")
      .eq("site_id", storeId)
      .maybeSingle();

    if (existing) {
      const { error: updateErr } = await supabase
        .from("micros_connections")
        .update(upsertData)
        .eq("id", (existing as any).id);

      if (updateErr) {
        logger.error("Failed to update micros connection", { error: updateErr });
        return NextResponse.json({ error: "Failed to save credentials" }, { status: 500 });
      }
    } else {
      const { error: insertErr } = await supabase
        .from("micros_connections")
        .insert(upsertData as any);

      if (insertErr) {
        logger.error("Failed to insert micros connection", { error: insertErr });
        return NextResponse.json({ error: "Failed to save credentials" }, { status: 500 });
      }
    }

    logger.info("Micros credentials saved", { storeId, storeName: (store as any).name });

    return NextResponse.json({ success: true, store_id: storeId });
  } catch (err) {
    logger.error("PUT /api/admin/integrations/[storeId]/micros failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST — Test connection ────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { storeId: string } },
) {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "POST /api/admin/integrations/[storeId]/micros");
  if (guard.error) return guard.error;

  try {
    const body = await req.json();
    const { auth_server_url: authServerUrl, client_id: clientId, username, password, org_identifier: orgIdentifier } = body as {
      auth_server_url?: string; client_id?: string; username?: string; password?: string; org_identifier?: string;
    };

    if (!authServerUrl || !clientId || !username || !password) {
      return NextResponse.json(
        { error: "auth_server_url, client_id, username, and password are required to test" },
        { status: 400 },
      );
    }

    // Attempt PKCE Step 1: authorize endpoint probe
    // We test by hitting the authorize endpoint — if it responds with a login form/redirect,
    // the server URL and client_id are valid.
    const authorizeUrl = `${authServerUrl.replace(/\/+$/, "")}/oidc-provider/v1/oauth2/authorize`;
    const testParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "apiaccount://callback",
      scope: "openid",
      code_challenge: "test",
      code_challenge_method: "S256",
      nonce: randomBytes(16).toString("hex"),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${authorizeUrl}?${testParams}`, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "ForgeStackOpsEngine/1.0",
          "x-app-key": orgIdentifier || clientId,
        },
      });
      clearTimeout(timeout);

      // A 200 or 302 means the auth server is reachable and recognizes the client
      if (res.status === 200 || res.status === 302 || res.status === 303) {
        return NextResponse.json({
          success: true,
          message: "Auth server reachable and client_id recognized",
          status_code: res.status,
        });
      }

      return NextResponse.json({
        success: false,
        message: `Auth server returned HTTP ${res.status}. Check your auth_server_url and client_id.`,
        status_code: res.status,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      const msg = fetchErr?.name === "AbortError"
        ? "Connection timed out (15s). Check the auth_server_url."
        : `Connection failed: ${fetchErr?.message || "Unknown error"}`;
      return NextResponse.json({ success: false, message: msg });
    }
  } catch (err) {
    logger.error("POST /api/admin/integrations/[storeId]/micros test failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── GET — Fetch credentials for a store (no password) ─────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { storeId: string } },
) {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/integrations/[storeId]/micros");
  if (guard.error) return guard.error;
  const { supabase } = guard;

  try {
    const { data: conn } = await supabase
      .from("micros_connections")
      .select("id, site_id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, username, api_account_name, status, last_sync_at, last_sync_error, created_at, updated_at")
      .eq("site_id", params.storeId)
      .maybeSingle();

    return NextResponse.json({ connection: conn ?? null });
  } catch (err) {
    logger.error("GET /api/admin/integrations/[storeId]/micros failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
