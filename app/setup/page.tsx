import { Suspense } from "react";
import { redirect } from "next/navigation";

import { SetupFlow } from "@/components/setup/setup-flow";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Self-serve entry for a brand-new church.
 *
 * A pastor lands here from the sign-in page (or a link), creates their
 * account, names their church, and walks straight into the dashboard as its
 * admin. Someone already linked to a church has nothing to do here and is sent
 * to the dashboard instead — setup must never look like a second way in.
 */
export default async function SetupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Their own membership row is visible under RLS; one row is enough to
    // know this account already has a church.
    const { data: membership } = await supabase
      .from("church_users")
      .select("church_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membership) redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md">
        <Suspense>
          <SetupFlow
            initialStep={user ? "church" : "account"}
            signedInEmail={user?.email ?? null}
          />
        </Suspense>
      </div>
    </main>
  );
}
