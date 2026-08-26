import { randomUUID } from "node:crypto";

import {
  MobileError,
  type MobileErrorCode,
  statusForCode,
} from "@/lib/mobile/v1/errors";

/**
 * The wire envelope every /api/mobile/v1 response uses.
 *
 * One shape for success and one for failure, both carrying the same meta
 * block. A client parses meta before it knows whether the call worked, which
 * is what makes correlation IDs useful in a support conversation about a
 * request that failed.
 */

export const MOBILE_API_VERSION = "2026-08-24";
export const MOBILE_API_MAJOR = 1;

/**
 * Clients older than this are refused with `client_version_unsupported` rather
 * than served a response they may mis-parse. Raise it only alongside a
 * documented migration window.
 */
export const MINIMUM_SUPPORTED_CLIENT_BUILD = 1;

export type MobileMeta = {
  apiVersion: string;
  apiMajor: number;
  requestId: string;
  minimumSupportedClientBuild: number;
  /** Set when this endpoint is scheduled for removal. */
  deprecation?: { sunsetOn: string; replacement: string };
};

export type MobileSuccess<T> = { ok: true; data: T; meta: MobileMeta };

export type MobileFailure = {
  ok: false;
  error: {
    code: MobileErrorCode;
    message: string;
    retryable: boolean;
    fields?: { field: string; issue: string }[];
    retryAfterSeconds?: number;
  };
  meta: MobileMeta;
};

/**
 * A correlation ID that is safe to print in a support ticket.
 *
 * Freshly random per request and derived from nothing about the caller, so it
 * identifies one request without identifying a person, device, or church.
 */
export function newRequestId(): string {
  return randomUUID();
}

function meta(requestId: string, deprecation?: MobileMeta["deprecation"]): MobileMeta {
  return {
    apiVersion: MOBILE_API_VERSION,
    apiMajor: MOBILE_API_MAJOR,
    requestId,
    minimumSupportedClientBuild: MINIMUM_SUPPORTED_CLIENT_BUILD,
    ...(deprecation ? { deprecation } : {}),
  };
}

export type CachePolicy =
  /** Authenticated, account-specific. Must never be shared or stored. */
  | "private-no-store"
  /** Authenticated but revalidatable by the same client only. */
  | "private-revalidate"
  /** Anonymous, identical for everyone. Safe for a shared cache. */
  | "public-short";

function cacheHeader(policy: CachePolicy): string {
  switch (policy) {
    case "private-no-store":
      return "no-store";
    case "private-revalidate":
      // `private` keeps it out of any shared cache; must-revalidate forces the
      // conditional request rather than silently serving a stale account view.
      return "private, no-cache, must-revalidate";
    case "public-short":
      return "public, max-age=60, stale-while-revalidate=300";
  }
}

export type ResponseOptions = {
  requestId: string;
  cache: CachePolicy;
  etag?: string;
  deprecation?: MobileMeta["deprecation"];
  extraHeaders?: Record<string, string>;
};

function baseHeaders(options: ResponseOptions): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheHeader(options.cache),
    "X-Request-Id": options.requestId,
    "X-FaithForm-Api-Version": MOBILE_API_VERSION,
    // Vary on Authorization so a shared cache can never serve one account's
    // response to another, even if a policy is later loosened by mistake.
    Vary: "Authorization, Accept-Encoding",
    ...(options.etag ? { ETag: options.etag } : {}),
    ...(options.extraHeaders ?? {}),
  };
}

export function mobileSuccess<T>(
  data: T,
  options: ResponseOptions,
): Response {
  const body: MobileSuccess<T> = {
    ok: true,
    data,
    meta: meta(options.requestId, options.deprecation),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: baseHeaders(options),
  });
}

/** 304 carries no body; the client keeps what it already has. */
export function mobileNotModified(options: ResponseOptions): Response {
  return new Response(null, { status: 304, headers: baseHeaders(options) });
}

export function mobileFailure(
  error: MobileError,
  options: ResponseOptions,
): Response {
  const body: MobileFailure = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable:
        error.code === "rate_limited" ||
        error.code === "unavailable" ||
        error.code === "internal_error",
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
    meta: meta(options.requestId, options.deprecation),
  };

  return new Response(JSON.stringify(body), {
    status: statusForCode(error.code),
    headers: {
      ...baseHeaders({ ...options, cache: "private-no-store", etag: undefined }),
      ...(error.retryAfterSeconds !== undefined
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {}),
    },
  });
}
