import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { registerDeviceRequestSchema } from "@/lib/mobile/v1/contract";
import {
  registerInstallation,
  retireInstallation,
} from "@/lib/faithful/push/installations";

export const dynamic = "force-dynamic";

/** The environment this deployment serves. Never taken from the request. */
function currentEnvironment(): string {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * Registers or refreshes this install's push token.
 *
 * Requires authentication, and the account is resolved from the token — a
 * device cannot register itself against someone else's account. The response
 * deliberately never echoes the provider token back.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = registerDeviceRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      // The message never quotes the body: it contains the token.
      throw new MobileError("invalid_request", "Could not register this device.");
    }
    return {
      data: await registerInstallation(userId, currentEnvironment(), parsed.data),
    };
  },
);

/**
 * Retires this install on sign-out. Other devices on the same account keep
 * receiving notifications, which is why the install id is required rather than
 * retiring everything.
 */
export const DELETE = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const installId = new URL(request.url).searchParams.get("installId");
    if (!installId) {
      throw new MobileError("invalid_request", "Missing device identifier.");
    }
    await retireInstallation(userId, currentEnvironment(), installId);
    return { data: { retired: true } };
  },
);
