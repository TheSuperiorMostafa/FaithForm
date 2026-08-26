import {
  MINIMUM_SUPPORTED_CLIENT_BUILD,
  MOBILE_API_MAJOR,
  MOBILE_API_VERSION,
} from "@/lib/mobile/v1/envelope";
import { publicRoute } from "@/lib/mobile/v1/handler";

export const dynamic = "force-dynamic";

/**
 * Reachability and version negotiation. Anonymous by design: a client must be
 * able to discover that it is too old *before* it tries to authenticate.
 *
 * Carries no provider name, project reference, or configuration value.
 */
export const GET = publicRoute({ cache: "public-short" }, async () => ({
  data: {
    status: "ok" as const,
    apiVersion: MOBILE_API_VERSION,
    apiMajor: MOBILE_API_MAJOR,
    minimumSupportedClientBuild: MINIMUM_SUPPORTED_CLIENT_BUILD,
    serverTime: new Date().toISOString(),
  },
}));
