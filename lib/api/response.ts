import { NextResponse } from "next/server";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiMeta {
  requestId?: string;
  durationMs?: number;
  siteId?: string;
  organisationId?: string;
  source?: string;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiError | null;
  meta?: ApiMeta;
}

interface JsonOptions<Legacy extends Record<string, unknown> = Record<string, never>> {
  status?: number;
  headers?: HeadersInit;
  meta?: ApiMeta;
  legacy?: Legacy;
}

interface JsonErrorOptions<Legacy extends Record<string, unknown> = Record<string, never>>
  extends JsonOptions<Legacy> {
  details?: unknown;
}

export function apiSuccess<T>(data: T, meta?: ApiMeta): ApiEnvelope<T> {
  return withMeta({ data, error: null }, meta);
}

export function apiError(
  code: string,
  message: string,
  meta?: ApiMeta,
  details?: unknown,
): ApiEnvelope<null> {
  return withMeta(
    {
      data: null,
      error: details === undefined ? { code, message } : { code, message, details },
    },
    meta,
  );
}

export function jsonSuccess<T, Legacy extends Record<string, unknown> = Record<string, never>>(
  data: T,
  options: JsonOptions<Legacy> = {},
) {
  const envelope = apiSuccess(data, options.meta);
  return NextResponse.json(
    { ...envelope, ...(options.legacy ?? {}) },
    { status: options.status ?? 200, headers: options.headers },
  );
}

export function jsonError<Legacy extends Record<string, unknown> = Record<string, never>>(
  code: string,
  message: string,
  options: JsonErrorOptions<Legacy> = {},
) {
  const envelope = apiError(code, message, options.meta, options.details);
  return NextResponse.json(
    { ...envelope, ...(options.legacy ?? {}) },
    { status: options.status ?? 500, headers: options.headers },
  );
}

export function compatSuccess<TEnvelope, Legacy extends Record<string, unknown>>(
  legacy: Legacy,
  data: TEnvelope,
  meta?: ApiMeta,
): Legacy & { envelope: ApiEnvelope<TEnvelope>; meta?: ApiMeta } {
  const envelope = apiSuccess(data, meta);
  return withMeta({ ...legacy, envelope }, meta);
}

export function compatError<Legacy extends Record<string, unknown>>(
  legacy: Legacy,
  code: string,
  message: string,
  meta?: ApiMeta,
  details?: unknown,
): Legacy & { envelope: ApiEnvelope<null>; meta?: ApiMeta } {
  const envelope = apiError(code, message, meta, details);
  return withMeta({ ...legacy, envelope }, meta);
}

export function jsonCompatSuccess<TEnvelope, Legacy extends Record<string, unknown>>(
  legacy: Legacy,
  data: TEnvelope,
  options: JsonOptions = {},
) {
  return NextResponse.json(
    compatSuccess(legacy, data, options.meta),
    { status: options.status ?? 200, headers: options.headers },
  );
}

export function jsonCompatError<Legacy extends Record<string, unknown>>(
  legacy: Legacy,
  code: string,
  message: string,
  options: JsonErrorOptions = {},
) {
  return NextResponse.json(
    compatError(legacy, code, message, options.meta, options.details),
    { status: options.status ?? 500, headers: options.headers },
  );
}

function withMeta<T extends object>(payload: T, meta?: ApiMeta): T & { meta?: ApiMeta } {
  if (!meta || Object.keys(meta).length === 0) return payload;
  return { ...payload, meta };
}
