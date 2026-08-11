import { redirect } from "next/navigation";

import { SetPasswordForm } from "./set-password-form";
import { mustChangePassword } from "@/lib/auth/temp-password";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Where a teammate lands the first time they sign in with the temporary
 * password an admin gave them. Middleware holds them here until they save one
 * of their own.
 */
export default async function SetPasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Reachable directly, so nothing stops someone opening it out of curiosity —
  // but there is nothing to do here once the flag is cleared.
  if (!mustChangePassword(user.user_metadata)) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md">
        <SetPasswordForm email={user.email ?? ""} />
      </div>
    </main>
  );
}
