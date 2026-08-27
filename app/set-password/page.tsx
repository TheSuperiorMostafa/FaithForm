import { redirect } from "next/navigation";

import { SetPasswordForm } from "./set-password-form";
import { mustChangePassword } from "@/lib/auth/temp-password";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Where a teammate lands the first time they sign in with the temporary
 * password an admin gave them — middleware holds them here until they save one
 * of their own — and where a password-recovery link lands anyone who forgot
 * theirs (`?reason=recovery`, arriving already signed in via the recovery
 * exchange in `/auth/callback`).
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const query = await searchParams;
  const isRecovery = query.reason === "recovery";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Reachable directly, so nothing stops someone opening it out of curiosity —
  // but there is nothing to do here once the flag is cleared. A recovery
  // arrival has no flag at all; the recovery link's session is its authority.
  if (!isRecovery && !mustChangePassword(user.user_metadata)) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md">
        <SetPasswordForm
          email={user.email ?? ""}
          reason={isRecovery ? "recovery" : "first_run"}
        />
      </div>
    </main>
  );
}
