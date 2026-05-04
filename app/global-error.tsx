"use client";
/**
 * app/global-error.tsx
 *
 * Next.js 14 global error boundary — wraps the entire app.
 * Captures React render errors (and their component stacks) in Sentry.
 *
 * This file MUST be a Client Component and MUST render its own <html>/<body>
 * because it replaces the root layout when it activates.
 *
 * See: https://nextjs.org/docs/app/building-your-application/routing/error-handling
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Capture the error in Sentry with the full component stack when available
    Sentry.captureException(error, {
      tags: { boundary: "global-error" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#0a0a0a",
          color: "#ededed",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#999", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            An unexpected error occurred. Our team has been notified.
            {error.digest && (
              <span
                style={{
                  display: "block",
                  marginTop: "0.5rem",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "#666",
                }}
              >
                Error ID: {error.digest}
              </span>
            )}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              background: "#fff",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 6,
              fontWeight: 500,
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
