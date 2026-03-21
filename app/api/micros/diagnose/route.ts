/**
 * GET /api/micros/diagnose
 *
 * Diagnostic endpoint: attempts only the authorize step (Step 1) and returns
 * raw HTTP status, headers, and body so we can debug Vercel-specific issues.
 */

import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getMicrosEnvConfig } from "@/lib/micros/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cfg = getMicrosEnvConfig();
  if (!cfg.authServer || !cfg.clientId) {
    return NextResponse.json({ error: "Missing MICROS config" });
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");

  const url = new URL("/oidc-provider/v1/oauth2/authorize", cfg.authServer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("redirect_uri", "apiaccount://callback");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "SiCantinaConcierge/1.0",
        Accept: "text/html, application/xhtml+xml, */*",
      },
      cache: "no-store",
    });

    clearTimeout(timer);

    const body = await res.text().catch(() => "(could not read body)");
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v.slice(0, 200); });
    const setCookies = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie().length
      : 0;

    return NextResponse.json({
      ok: true,
      status: res.status,
      statusText: res.statusText,
      redirected: res.redirected,
      type: res.type,
      url: res.url,
      headersCount: Object.keys(headers).length,
      setCookieCount: setCookies,
      headers,
      bodyPreview: body.slice(0, 500),
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : "unknown",
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    });
  }
}
