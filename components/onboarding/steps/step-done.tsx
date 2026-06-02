"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { IntegrationStatus } from "@/components/onboarding/OnboardingWizard";
import { Button } from "@/components/ui/button";

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
        <p className="mt-2 text-sm opacity-90">
          Your church is ready to use FaithForm.
        </p>
      </div>

      <div className="space-y-4 px-2 py-6 sm:px-4">
        <ul className="space-y-2 text-sm">
          <SummaryRow done={accountCreated || true} label="Account created" />
          <SummaryRow done={profileSaved || true} label="Church profile saved" />
          <SummaryRow
            done={integrations.google.connected}
            label={`Google ${integrations.google.connected ? "Connected" : "Not connected yet"}`}
          />
          <SummaryRow
            done={integrations.facebook.connected}
            label={`Facebook ${integrations.facebook.connected ? "Connected" : "Not connected yet"}`}
          />
        </ul>

        {skippedIntegrations && (
          <p className="text-xs text-muted-foreground">
            You can connect these later in Settings.
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {pending ? (
          <Button disabled className="h-12 w-full text-base">
            Finishing setup…
          </Button>
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-accent px-5 text-base font-semibold text-accent-foreground transition-opacity hover:opacity-90"
          >
            Go to Dashboard →
          </Link>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-foreground">
      <CheckCircle2
        className={done ? "size-4 text-emerald-600" : "size-4 text-muted-foreground"}
        strokeWidth={2}
      />
      {label}
    </li>
  );
}
