"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  type LoginFormState,
  type PasswordLoginState,
  type PasswordResetState,
} from "./actions";

const magicInitial: LoginFormState = { ok: false };
const passwordInitial: PasswordLoginState = { ok: false };
const resetInitial: PasswordResetState = { ok: false };

function MagicSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-12 w-full px-5 text-base"
    >
      {pending ? "Sending link…" : "Send magic link"}
    </Button>
  );
}

function PasswordSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-12 w-full px-5 text-base"
    >
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function ResetSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-12 w-full px-5 text-base"
    >
      {pending ? "Sending…" : "Email me a reset link"}
    </Button>
  );
}

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupComplete = searchParams.get("notice") === "setup_complete";
  // Password first: teammates are set up with a temporary password, so that is
  // the path most people arrive on. Magic link stays for anyone who prefers it.
  const [mode, setMode] = useState<"magic" | "password" | "reset">("password");

  const [magicState, magicAction] = useFormState(sendMagicLink, magicInitial);
  const [resetState, resetAction] = useFormState(sendPasswordReset, resetInitial);
  const [passwordState, passwordAction] = useFormState(
    async (state: PasswordLoginState, formData: FormData) => {
      const result = await signInWithPassword(state, formData);
      if (result.ok) {
        router.replace("/dashboard");
        router.refresh();
      }
      return result;
    },
    passwordInitial,
  );

  if ((mode === "magic" && magicState.ok) || (mode === "reset" && resetState.ok)) {
    return (
      <div className="relative rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <div className="absolute right-4 top-4">
          <ThemeToggle variant="compact" />
        </div>
        <Logo size={56} className="mx-auto mb-4" />
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          Check your email
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          {mode === "magic"
            ? "We sent you a magic link. Tap it on your phone or computer to sign in."
            : "If that email has a FaithForm account, a password-reset link is on its way."}
        </p>
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <div className="relative rounded-2xl border border-border bg-card p-8 shadow-card">
        <div className="absolute right-4 top-4">
          <ThemeToggle variant="compact" />
        </div>
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={64} priority className="mb-3" />
          <h1 className="font-heading text-[26px] font-bold text-foreground">
            Reset your password
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Enter your email and we&apos;ll send you a link to set a new one.
          </p>
        </div>

        <form action={resetAction} className="space-y-4">
          <div>
            <label
              htmlFor="email-reset"
              className="mb-2 block text-sm font-semibold"
            >
              Email
            </label>
            <input
              id="email-reset"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@yourchurch.org"
              className={inputClass}
            />
          </div>

          {resetState.error && (
            <p className="text-base text-destructive" role="alert">
              {resetState.error}
            </p>
          )}

          <ResetSubmit />
        </form>

        <button
          type="button"
          onClick={() => setMode("password")}
          className="mt-6 w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl border border-border bg-card p-8 shadow-card">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="compact" />
      </div>
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo size={64} priority className="mb-3" />
        <h1 className="font-heading text-[26px] font-bold text-foreground">FaithForm</h1>
        {setupComplete && (
          <p className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-foreground">
            Setup already complete. Sign in to continue.
          </p>
        )}
        <p className="mt-2 text-base text-muted-foreground">
          {mode === "magic"
            ? "Sign in with your email — no password needed."
            : "Sign in with your email and password. New to the team? Use the temporary password your church admin gave you."}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-muted/40 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("magic")}
          className={cn(
            "min-h-10 rounded-lg font-semibold transition-colors",
            mode === "magic"
              ? "bg-accent text-accent-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Magic link
        </button>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={cn(
            "min-h-10 rounded-lg font-semibold transition-colors",
            mode === "password"
              ? "bg-accent text-accent-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Password
        </button>
      </div>

      {mode === "magic" ? (
        <form action={magicAction} className="space-y-4">
          <div>
            <label
              htmlFor="email-magic"
              className="mb-2 block text-sm font-semibold"
            >
              Email
            </label>
            <input
              id="email-magic"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@yourchurch.org"
              className={inputClass}
            />
          </div>

          {magicState.error && (
            <p className="text-base text-destructive" role="alert">
              {magicState.error}
            </p>
          )}

          <MagicSubmit />
        </form>
      ) : (
        <form action={passwordAction} className="space-y-4">
          <div>
            <label
              htmlFor="email-pw"
              className="mb-2 block text-sm font-semibold"
            >
              Email
            </label>
            <input
              id="email-pw"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@yourchurch.org"
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-semibold"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className={inputClass}
            />
          </div>

          {passwordState.error && (
            <p className="text-base text-destructive" role="alert">
              {passwordState.error}
            </p>
          )}

          <PasswordSubmit />

          <button
            type="button"
            onClick={() => setMode("reset")}
            className="w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </button>
        </form>
      )}

      <p className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        New to FaithForm?{" "}
        <Link
          href="/setup"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          Set up your church
        </Link>
      </p>
    </div>
  );
}
