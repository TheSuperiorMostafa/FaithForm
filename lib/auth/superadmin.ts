import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
