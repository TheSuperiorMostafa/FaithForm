"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  sendMagicLink,
  signInWithPassword,
  type LoginFormState,
  type PasswordLoginState,
} from "./actions";

const magicInitial: LoginFormState = { ok: false };
const passwordInitial: PasswordLoginState = { ok: false };

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

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupComplete = searchParams.get("notice") === "setup_complete";
  const [mode, setMode] = useState<"magic" | "password">("magic");

  const [magicState, magicAction] = useFormState(sendMagicLink, magicInitial);
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

  if (mode === "magic" && magicState.ok) {
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
          We sent you a magic link. Tap it on your phone or computer to sign
          in.
        </p>
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
            : "Sign in with your email and password."}
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
        </form>
      )}
    </div>
  );
}
