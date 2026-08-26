import { createClient } from "@supabase/supabase-js";

import { VisitorError } from "@/lib/faithful/errors";
import {
  MobileError,
  mobileCodeForDomainCode,
} from "@/lib/mobile/v1/errors";
import {
  mobileFailure,
  mobileSuccess,
  newRequestId,
  MINIMUM_SUPPORTED_CLIENT_BUILD,
  type CachePolicy,
  type ResponseOptions,
} from "@/lib/mobile/v1/envelope";
import { parseClientBuild } from "@/lib/mobile/v1/protocol";

/**
 * The single entry point every /api/mobile/v1 route uses.
 *
 * It owns the four things that must never be re-implemented per route:
 * correlation, client-version gating, authentication, and error redaction.
 * A route body therefore only ever contains domain work.
 */

export type MobileContext = {
  requestId: string;
  /** Present only on authenticated routes. Resolved server-side from the token. */
  userId: string;
  request: Request;
  /** Dynamic route segments, already awaited. */
  params: Record<string, string>;
};

export type PublicContext = Omit<MobileContext, "userId">;

/**
 * A route readable signed out, but whose response may legitimately differ for a
 * signed-in caller — a church profile that also reports your own relationship,
 * for instance. `userId` is null rather than the request being refused.
 */
export type OptionalAuthContext = Omit<MobileContext, "userId"> & {
  userId: string | null;
};

/**
 * Next passes dynamic segments as a promise in the App Router. A static route
 * receives an empty one, which is why `params` is required rather than
 * optional — the framework's own route typing insists on it.
 */
type RouteArgs = { params: Promise<Record<string, string>> };

async function resolveParams(args: RouteArgs): Promise<Record<string, string>> {
  return (await args.params) ?? {};
}

/**
 * Verifies the caller's Supabase access token.
 *
 * The token is verified against Supabase using the *publishable* key, never a
 * service-role credential — the native app holds no privileged secret, and this
 * server path does not need one to answer "who is this token for".
 */
async function resolveUserId(request: Request): Promise<string> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new MobileError("unauthenticated", "Sign in to continue.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new MobileError("unavailable", "Service unavailable.");
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    // An expired token is a distinct, actionable case: the client should
    // refresh and retry rather than sending the person back to sign-in.
    const expired = /expired/i.test(error?.message ?? "");
    throw new MobileError(
      expired ? "session_expired" : "unauthenticated",
      expired ? "Your session has expired." : "Sign in to continue.",
    );
  }

  return data.user.id;
}

function assertSupportedClient(request: Request): void {
  const build = parseClientBuild(request);
  // Absent is tolerated: an older client that never learned to send the header
  // must still be able to reach the server and be told to upgrade.
  if (build !== null && build < MINIMUM_SUPPORTED_CLIENT_BUILD) {
    throw new MobileError(
      "client_version_unsupported",
      "Update Faithful to continue.",
    );
  }
}

/**
 * Converts anything thrown into a safe envelope.
 *
 * Only `MobileError` and Prompt 3's `VisitorError` carry a message the client
 * may see. Everything else — a driver error, a provider failure, a
 * programming mistake — becomes a generic `internal_error`, so no table name,
 * constraint name, stack frame, or provider string can reach a device.
 */
function toFailure(error: unknown, options: ResponseOptions): Response {
  if (error instanceof MobileError) return mobileFailure(error, options);

  if (error instanceof VisitorError) {
    const code = mobileCodeForDomainCode(error.code);
    return mobileFailure(new MobileError(code, error.message), options);
  }

  // Deliberately not logging the error object: it may embed a query, a row, or
  // a provider payload. The request id is what ties a report to server logs.
  console.error(`[mobile] unhandled error requestId=${options.requestId}`);
  return mobileFailure(
    new MobileError("internal_error", "Something went wrong."),
    options,
  );
}

type HandlerOptions = { cache: CachePolicy };

export function publicRoute<T>(
  options: HandlerOptions,
  body: (context: PublicContext) => Promise<{ data: T; etag?: string } | Response>,
): (request: Request, args: RouteArgs) => Promise<Response> {
  return async (request: Request, args: RouteArgs) => {
    const requestId = newRequestId();
    const responseOptions: ResponseOptions = { requestId, cache: options.cache };
    try {
      assertSupportedClient(request);
      const result = await body({
        requestId,
        request,
        params: await resolveParams(args),
      });
      if (result instanceof Response) return result;
      return mobileSuccess(result.data, { ...responseOptions, etag: result.etag });
    } catch (error) {
      return toFailure(error, responseOptions);
    }
  };
}

/**
 * Authenticates when a token is present and usable, and proceeds anonymously
 * when it is not. A malformed or expired token is treated as absent rather than
 * as an error: someone browsing a church profile with a stale session should
 * see the public view, not a wall.
 */
export function optionalAuthRoute<T>(
  options: HandlerOptions,
  body: (context: OptionalAuthContext) => Promise<{ data: T; etag?: string } | Response>,
): (request: Request, args: RouteArgs) => Promise<Response> {
  return async (request: Request, args: RouteArgs) => {
    const requestId = newRequestId();
    const responseOptions: ResponseOptions = { requestId, cache: options.cache };
    try {
      assertSupportedClient(request);
      let userId: string | null = null;
      if (request.headers.get("authorization")) {
        userId = await resolveUserId(request).catch(() => null);
      }
      const result = await body({
        requestId,
        request,
        userId,
        params: await resolveParams(args),
      });
      if (result instanceof Response) return result;
      return mobileSuccess(result.data, { ...responseOptions, etag: result.etag });
    } catch (error) {
      return toFailure(error, responseOptions);
    }
  };
}

export function authenticatedRoute<T>(
  options: HandlerOptions,
  body: (context: MobileContext) => Promise<{ data: T; etag?: string } | Response>,
): (request: Request, args: RouteArgs) => Promise<Response> {
  return async (request: Request, args: RouteArgs) => {
    const requestId = newRequestId();
    const responseOptions: ResponseOptions = { requestId, cache: options.cache };
    try {
      assertSupportedClient(request);
      const userId = await resolveUserId(request);
      const result = await body({
        requestId,
        request,
        userId,
        params: await resolveParams(args),
      });
      if (result instanceof Response) return result;
      return mobileSuccess(result.data, { ...responseOptions, etag: result.etag });
    } catch (error) {
      return toFailure(error, responseOptions);
    }
  };
}
