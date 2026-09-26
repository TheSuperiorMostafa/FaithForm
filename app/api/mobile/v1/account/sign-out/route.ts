import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { signOut } from "@/lib/mobile/v1/account-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Server-side sign-out. The client still discards its own token; this bumps the
 * authorization version so any cached decision keyed to the old one is
 * detectably stale everywhere else too.
 *
 * It also ends this device's Supabase session. Discarding the token locally
 * left its refresh token alive, so a copy of it — from a backup, a log, a
 * shared phone — could keep minting fresh access tokens after the person had
 * signed out. `local` ends only this session: the same person signed in on the
 * web, or on another phone, stays signed in there.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const result = await signOut(userId);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    try {
      const { error } = await createAdminClient().auth.admin.signOut(token, "local");
      if (error) console.error("[mobile sign-out] session revoke failed:", error.status ?? "unknown");
    } catch {
      // Best effort: the person is signed out on the phone either way, and the
      // authorization version above already moved.
      console.error("[mobile sign-out] session revoke failed");
    }

    return {
      data: {
        signedOut: true as const,
        authorizationVersion: result.authorizationVersion,
      },
    };
  },
);
