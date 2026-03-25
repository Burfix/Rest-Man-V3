/**
 * Structured Logger — JSON-formatted logging for production observability.
 *
 * Outputs structured JSON to stdout/stderr for Vercel log drain compatibility.
 * Includes request correlation IDs when available.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Action created", { route: "/api/actions", userId, siteId });
 *   logger.error("DB query failed", { route: "/api/actions", err });
 */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  // Serialize errors properly
  if (meta?.err instanceof Error) {
    entry.err = {
      name: meta.err.name,
      message: meta.err.message,
      stack: meta.err.stack,
    };
  }

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    emit("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    emit("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    emit("error", message, meta);
  },
};
