import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUser } from "@/lib/auth/superadmin";
import { resolveSignedInLanding } from "@/lib/auth/signed-in-landing";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Route by what the account actually is, not by the fact of a session.
    // Sending every authenticated user to /dashboard is what used to trap
    // Faithful visitor accounts in a /login ↔ /dashboard redirect loop that
    // rendered as a blank page.
    const hasChurchMembership = Boolean(await getChurchAuth());
    const landing = resolveSignedInLanding({
      hasChurchMembership,
      isPlatformAdmin: hasChurchMembership ? false : await isPlatformAdminUser(user),
    });

    if (landing.kind === "dashboard") {
      redirect("/dashboard");
    }
    if (landing.kind === "admin") {
      redirect("/admin");
    }
    return <NoDashboardAccess />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-card" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * A signed-in account with no dashboard to show — a Faithful visitor account,
 * or a staff account whose membership was removed. Rendered as a page, never
 * another redirect, and it grants nothing: the only actions are leaving and
 * knowing where to go instead.
 */
function NoDashboardAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <Logo size={56} className="mx-auto mb-4" />
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          This account can&apos;t open the dashboard
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          You&apos;re signed in, but this account isn&apos;t on a church&apos;s
          staff team. If you created your account in the Faithful app, you&apos;re
          all set — open Faithful on your phone to continue.
        </p>
        <p className="mt-3 text-base text-muted-foreground">
          If you should have staff access, ask your church admin to invite you.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <Button type="submit" className="h-12 w-full px-5 text-base">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
