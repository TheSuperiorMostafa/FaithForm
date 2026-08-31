import { redirect } from "next/navigation";
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

export async function requireSuperAdmin(): Promise<User> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
