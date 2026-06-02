import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type ChurchAuth = {
  userId: string;
  churchId: string;
  role: string;
  isAdmin: boolean;
};

export async function getChurchAuth(
  supabase?: SupabaseClient,
): Promise<ChurchAuth | null> {
  const client = supabase ?? createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) return null;

  const { data: link, error } = await client
    .from("church_users")
    .select("church_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getChurchAuth church_users:", error.message);
  }

  let resolvedLink = link;
  if (!resolvedLink?.church_id) {
    const admin = createAdminClientOrNull();
    if (admin) {
      const { data: adminLink, error: adminError } = await admin
        .from("church_users")
        .select("church_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (adminError) {
        console.error("getChurchAuth admin church_users:", adminError.message);
      }

      resolvedLink = adminLink;
    }
  }

  if (!resolvedLink?.church_id) return null;

  const role = resolvedLink.role as string;
  return {
    userId: user.id,
    churchId: resolvedLink.church_id as string,
    role,
    isAdmin: role === "admin" || role === "owner",
  };
}

export async function requireChurchAuth(): Promise<ChurchAuth> {
  const auth = await getChurchAuth();
  if (!auth) {
    throw new Error("Unauthorized");
  }
  return auth;
}
