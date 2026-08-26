import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import {
  buildGeofenceConfiguration,
  refusalMessage,
} from "@/lib/attendance/v2/geofence-config";

export const dynamic = "force-dynamic";

/**
 * The geofence configuration a native client registers regions from.
 *
 * Five gates, all re-derived server-side on every request: active account,
 * usable church relationship, verified People link, granted consent, and a
 * church that has geofence attendance enabled with a positioned campus. Any
 * failure returns a typed refusal and the client removes its regions.
 *
 * `private, must-revalidate` with a strong ETag: revalidation is cheap, but a
 * shared cache must never serve one account's configuration to another, and a
 * revocation must take effect on the next check rather than at the end of a
 * max-age.
 *
 * The centre and radius are in the response because the OS cannot monitor a
 * region it has not been told about. That is not a leak — the address is public
 * — and it is not where the security lives. Every attempt submitted later is
 * validated against the campus position the *server* holds.
 */
export const GET = authenticatedRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const result = await buildGeofenceConfiguration(userId, params.slug);

    const data = result.ok
      ? { configuration: result.configuration, refusalReason: null, message: null }
      : {
          configuration: null,
          refusalReason: result.reason,
          message: refusalMessage(result.reason),
        };

    // ---------------------------------------------------------------------
    // The ETag is computed over the response body itself.
    //
    // Not over a hand-picked subset. A subset has to be maintained in step
    // with the payload, and the moment the two drift the server starts
    // answering 304 to a client whose copy differs in the field that was
    // forgotten. This version had exactly that bug: `expiresAt` was excluded
    // because it moved on every request, so a client revalidating an *expired*
    // configuration was told "not modified" and never received a new expiry.
    //
    // Two changes fix it together, and neither works alone:
    //
    //   1. `expiresAt` is now deterministic — a function of configuration
    //      state rather than arrival time (see `resolveExpiry`). Identical
    //      state yields an identical body.
    //   2. The validator covers the whole body, `expiresAt` included, so a
    //      changed expiry is a changed ETag by construction.
    //
    // Together they give the property the client depends on: **a 304 is only
    // ever served while the client's cached `expiresAt` is still in the
    // future.** An expired configuration always revalidates into either a
    // fresh 200 or an explicit refusal, never a stale 304.
    //
    // The church slug is included because a refusal body is otherwise identical
    // across churches, and two churches refusing for the same reason must not
    // share a validator.
    // ---------------------------------------------------------------------
    const etag = computeEtag({ church: params.slug, data });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }

    return { data, etag };
  },
);
