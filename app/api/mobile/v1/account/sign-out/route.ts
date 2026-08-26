import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { signOut } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * Server-side sign-out. The client still discards its own token; this bumps the
 * authorization version so any cached decision keyed to the old one is
 * detectably stale everywhere else too.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId }) => {
    const result = await signOut(userId);
    return {
      data: {
        signedOut: true as const,
        authorizationVersion: result.authorizationVersion,
      },
    };
  },
);
