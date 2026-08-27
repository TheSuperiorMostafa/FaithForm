"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  createChurchForCurrentUser,
  createSetupAccount,
  type SetupAccountState,
  type SetupChurchState,
} from "@/app/setup/actions";
import { TimezoneSelect } from "@/components/admin/timezone-select";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const accountInitial: SetupAccountState = { ok: false };
const churchInitial: SetupChurchState = { ok: false };

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-12 w-full px-5 text-base">
      {pending ? busy : idle}
    </Button>
  );
}

type SetupStep = "account" | "church";

/**
 * Two steps and nothing more: who you are, then what your church is called.
 * Everything else — logo, address, service times, team — lives in the
 * dashboard the pastor is about to enter.
 */
export function SetupFlow({
  initialStep,
  signedInEmail,
}: {
  initialStep: SetupStep;
  signedInEmail: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(initialStep);

  const [accountState, accountAction] = useFormState(
    async (state: SetupAccountState, formData: FormData) => {
      const result = await createSetupAccount(state, formData);
      if (result.ok && !result.needsEmailConfirmation) {
        setStep("church");
        router.refresh();
      }
      return result;
    },
    accountInitial,
  );

  const [churchState, churchAction] = useFormState(
    async (state: SetupChurchState, formData: FormData) => {
      const result = await createChurchForCurrentUser(state, formData);
      if (result.ok) {
        router.replace("/dashboard");
        router.refresh();
      }
      return result;
    },
    churchInitial,
  );

  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    } catch {
      return "America/New_York";
    }
  });

  if (accountState.ok && accountState.needsEmailConfirmation) {
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
          We sent you a confirmation link. It brings you straight back here to
          finish setting up your church.
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
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          {step === "account" ? "Set up your church" : "Name your church"}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {step === "account"
            ? "Create your account first. You'll be your church's admin."
            : signedInEmail
              ? `Signed in as ${signedInEmail}. Tell us about your church.`
              : "Tell us about your church."}
        </p>
      </div>

      {step === "account" ? (
        <form action={accountAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="setup-first" className="mb-2 block text-sm font-semibold">
                First name
              </label>
              <input
                id="setup-first"
                name="firstName"
                autoComplete="given-name"
                required
                placeholder="Sarah"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="setup-last" className="mb-2 block text-sm font-semibold">
                Last name
              </label>
              <input
                id="setup-last"
                name="lastName"
                autoComplete="family-name"
                placeholder="Okafor"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="setup-email" className="mb-2 block text-sm font-semibold">
              Email
            </label>
            <input
              id="setup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@yourchurch.org"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="setup-password" className="mb-2 block text-sm font-semibold">
              Password
            </label>
            <input
              id="setup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              className={inputClass}
            />
          </div>

          {accountState.error && (
            <p className="text-base text-destructive" role="alert">
              {accountState.error}
            </p>
          )}

          <SubmitButton idle="Create account" busy="Creating account…" />
        </form>
      ) : (
        <form action={churchAction} className="space-y-4">
          <div>
            <label htmlFor="setup-church-name" className="mb-2 block text-sm font-semibold">
              Church name
            </label>
            <input
              id="setup-church-name"
              name="name"
              required
              maxLength={120}
              placeholder="Grace Community Church"
              className={inputClass}
            />
          </div>

          <div>
            <TimezoneSelect id="setup-timezone" value={timezone} onChange={setTimezone} />
            <input type="hidden" name="timezone" value={timezone} />
          </div>

          {churchState.error && (
            <p className="text-base text-destructive" role="alert">
              {churchState.error}
            </p>
          )}

          <SubmitButton idle="Create church" busy="Creating church…" />
          <p className="text-center text-sm text-muted-foreground">
            You can add your logo, address and service times from the dashboard.
          </p>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already using FaithForm?{" "}
        <Link href="/login" className="font-semibold text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
