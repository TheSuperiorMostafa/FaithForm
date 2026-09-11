import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether this user administers the platform — as a fact, not a gate.
 *
 * `requireSuperAdmin` below stays the gate for /admin. This exists for places
 * that must *route* an authenticated person (the sign-in page deciding between
 * /dashboard, /admin, and a no-access screen) without redirecting as a side
 * effect. Errors count as "no": a lookup failure must never widen access.
 */
export async function isPlatformAdminUser(user: User): Promise<boolean> {
  if (isBootstrapSuperAdminEmail(user.email)) {
    return true;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("isPlatformAdminUser platform_admins:", error.message);
    return false;
  }

  return Boolean(data?.user_id);
}

/**
 * The same question as `isPlatformAdminUser`, asked with only an id.
 *
 * Impersonation re-checks membership on every request and has no `User` object
 * to hand — only the id the signed note names.
 */
export async function isPlatformAdminUserId(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("isPlatformAdminUserId platform_admins:", error.message);
    return false;
  }

  if (data?.user_id) return true;

  // Bootstrap admins are named by email, not by a row, so the address has to
  // be fetched before the fallback can be applied.
  const { data: user } = await admin.auth.admin.getUserById(userId);
  return isBootstrapSuperAdminEmail(user.user?.email);
}

/**
 * Who is signed in, from the access token itself.
 *
 * `getClaims` verifies the token's signature locally against the project's
 * published keys, so answering "who is this" costs no round trip to the Auth
 * server. `getUser` did, and the admin dashboard asked it on every layout
 * render, every page, and every one of two dozen actions, with hover
 * prefetches asking again. The Auth API throttled that, and a throttled
 * answer reads as "no user", so the admin was sent back to the sign-in page
 * for doing nothing more than clicking around.
 *
 * The claims carry everything a caller here reads: id, email, and the
 * metadata a password-reset gate looks at. The database remains the
 * authority on whether that person administers the platform.
 */
async function currentUserFromClaims(): Promise<User | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const id = typeof claims?.sub === "string" ? claims.sub : null;
  if (error || !claims || !id) return null;

  return {
    id,
    email: typeof claims.email === "string" ? claims.email : undefined,
    app_metadata: (claims.app_metadata as User["app_metadata"]) ?? {},
    user_metadata: (claims.user_metadata as User["user_metadata"]) ?? {},
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    created_at: "",
  };
}

async function resolveSuperAdmin(): Promise<User> {
  const user = await currentUserFromClaims();

  if (!user) {
    redirect("/login");
  }

  if (isBootstrapSuperAdminEmail(user.email)) {
    return user;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("requireSuperAdmin platform_admins:", error.message);
    redirect("/login");
  }

  if (!data?.user_id) {
    redirect("/login");
  }

  return user;
}

// One answer per request: the layout, the page, and every server component
// underneath share it instead of each verifying the same token and reading
// the same platform_admins row.
export const requireSuperAdmin: () => Promise<User> = cache(resolveSuperAdmin);
