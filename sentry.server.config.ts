import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,

  // Capture 100% of errors, 20% of transactions
  sampleRate: 1.0,
  tracesSampleRate: 0.2,

  environment:
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development",

  // NOTE: health/route.ts calls Sentry.captureMessage when degraded/unhealthy.
  // This config does not filter those messages — they are always captured.
});
