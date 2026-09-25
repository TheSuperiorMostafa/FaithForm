"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { IntegrationStatus } from "@/components/onboarding/OnboardingWizard";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StepDoneProps = {
  churchName: string;
  accountCreated: boolean;
  profileSaved: boolean;
  integrations: IntegrationStatus;
  pending: boolean;
  error: string | null;
};

export function StepDone({
  churchName,
  accountCreated,
  profileSaved,
  integrations,
  pending,
  error,
}: StepDoneProps) {
  const skippedIntegrations =
    !integrations.google.connected || !integrations.facebook.connected;

  return (
    <div className="-mx-4 -mt-4 overflow-hidden sm:-mx-10 sm:-mt-10">
      <div className="bg-primary px-6 py-8 text-center text-primary-foreground">
        <div className="onboarding-checkmark mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-accent">
          <CheckCircle2 className="size-9 text-accent-foreground" strokeWidth={2} />
        </div>
        <h2 className="font-heading text-2xl font-semibold">
          You&apos;re all set, {churchName}!
        </h2>
        <p className="mt-2 text-base opacity-90">
          Your church is ready to use FaithForm.
        </p>
      </div>

      <div className="space-y-4 px-2 py-6 sm:px-4">
        <ul className="space-y-3 text-base">
          <SummaryRow
            done={accountCreated}
            label={accountCreated ? "Account created" : "Account: finish signing in from your email"}
          />
          <SummaryRow
            done={profileSaved}
            label={profileSaved ? "Church profile saved" : "Church details: you can add them later"}
          />
          <SummaryRow
            done={integrations.google.connected}
            label={integrations.google.connected ? "Google connected" : "Google: not connected yet"}
          />
          <SummaryRow
            done={integrations.facebook.connected}
            label={integrations.facebook.connected ? "Facebook connected" : "Facebook: not connected yet"}
          />
        </ul>

        {skippedIntegrations && (
          <p className="text-base text-muted-foreground">
            You can connect these any time in Settings → Connected accounts.
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {pending ? (
          <Button disabled size="lg" className="h-12 w-full">
            Finishing setup…
          </Button>
        ) : (
          <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "h-12 w-full")}>
            Go to FaithForm
          </Link>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-foreground">
      {done ? (
        <CheckCircle2 className="size-5 text-emerald-600" strokeWidth={2} aria-hidden />
      ) : (
        <Circle className="size-5 text-muted-foreground" strokeWidth={2} aria-hidden />
      )}
      <span>
        <span className="sr-only">{done ? "Done: " : "Not done yet: "}</span>
        {label}
      </span>
    </li>
  );
}
