import * as Sentry from "@sentry/nextjs";

const sampleRate = parseFloat(
  process.env.NEXT_PUBLIC_SENTRY_SAMPLE_RATE ?? "0.1",
);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 100% of errors; configurable % of performance transactions
  sampleRate: 1.0,
  tracesSampleRate: sampleRate,

  // Session replay — only start recording when an error occurs
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,

  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development",

  integrations: [
    Sentry.replayIntegration({
      // Mask all text and block all media by default (no PII in replays)
      maskAllText:  true,
      blockAllMedia: true,
    }),
  ],
});
