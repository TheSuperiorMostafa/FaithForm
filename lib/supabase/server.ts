import { createServerClient } from "@supabase/ssr";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readImpersonationNote } from "@/lib/auth/impersonation";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

function createSessionClient(): SupabaseClient {
  // Kept synchronous so the existing 100+ call sites retain one shared client
  // contract during the security-only Next 15 upgrade. Next 15 explicitly
  // provides this migration type; a later framework-modernization prompt can
  // make the application-wide API asynchronous.
  const cookieStore = cookies() as unknown as UnsafeUnwrappedCookies;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — safe to ignore when middleware refreshes the session
          }
        },
      },
    },
  );
}

/** Everything that reads or writes rows, as opposed to answering "who is this". */
const DATA_ACCESSORS = new Set(["from", "rpc", "storage", "schema"]);

/**
 * The session client, with its data access redirected through the service role.
 *
 * A platform admin working inside a church has no `church_users` row, so every
 * RLS-scoped read would come back empty and the dashboard would render as a
 * signed-in blank. Rather than granting platform admins a policy exemption on
 * every table — or, worse, writing them a real membership row that then shows
 * up in the church's own team list — the credential is swapped for the duration
 * of the request.
 *
 * `auth` is deliberately NOT redirected. Identity keeps coming from the real
 * session cookie, so `getClaims()` still reports the admin as themselves and
 * the impersonation check can compare the two.
 *
 * The consequence worth knowing: while this is active, a query that relied on
 * RLS to scope itself to one church instead of saying `.eq("church_id", …)`
 * will see every church. Queries in this codebase pass the church id
 * explicitly, and the only person who can be here already reads every church
 * through /admin, but a new query should still filter for itself.
 */
function withServiceRoleData(
  session: SupabaseClient,
  admin: SupabaseClient,
): SupabaseClient {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && DATA_ACCESSORS.has(prop)) {
        const value = (admin as unknown as Record<string, unknown>)[prop];
        return typeof value === "function" ? value.bind(admin) : value;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function createClient(): SupabaseClient {
  const session = createSessionClient();

  // Signature and expiry only — this runs synchronously and cannot query the
  // database. Forging a note requires the signing secret, which is the service
  // key itself, so a valid signature is not a weaker claim than the credential
  // it unlocks. Whether the bearer is *still* a platform admin is re-checked
  // against `platform_admins` on every request by `getActiveImpersonation`,
  // which is what decides whether any of this reaches the interface.
  if (!readImpersonationNote()) return session;

  const admin = createAdminClientOrNull();
  return admin ? withServiceRoleData(session, admin) : session;
}
