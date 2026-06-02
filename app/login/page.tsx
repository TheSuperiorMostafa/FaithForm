import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
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
