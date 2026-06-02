"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  completeOnboarding,
  createOnboardingAccount,
  getOnboardingIntegrationStatus,
  updateChurchProfile,
  uploadChurchLogo,
} from "@/app/onboarding/actions";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { StepAccount } from "@/components/onboarding/steps/step-account";
import { StepDone } from "@/components/onboarding/steps/step-done";
import { StepFacebook } from "@/components/onboarding/steps/step-facebook";
import { StepGoogle } from "@/components/onboarding/steps/step-google";
import { StepProfile } from "@/components/onboarding/steps/step-profile";
import { StepWelcome } from "@/components/onboarding/steps/step-welcome";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ProfileData = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  phone: string;
  logoUrl: string;
};

export type IntegrationStatus = {
  google: { connected: boolean; email: string | null };
  facebook: { connected: boolean; pageName: string | null };
};

type OnboardingWizardProps = {
  token: string;
  churchId: string;
  churchName: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  initialStep: number;
  initialProfile: ProfileData;
  integrationStatus: IntegrationStatus;
};

const STEP_LABELS = [
  "Welcome",
  "Account",
  "Profile",
  "Google",
  "Facebook",
  "Done",
];

export function OnboardingWizard(props: OnboardingWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(props.initialStep);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [profile, setProfile] = useState<ProfileData>(props.initialProfile);
  const [integrations, setIntegrations] = useState<IntegrationStatus>(
    props.integrationStatus,
  );
  const [accountCreated, setAccountCreated] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [completionDone, setCompletionDone] = useState(false);

  const goToStep = useCallback(
    (next: number) => {
      const clamped = Math.min(6, Math.max(1, next));
      setStep(clamped);
      setError(null);
      router.replace(
        `/onboarding?token=${encodeURIComponent(props.token)}&step=${clamped}`,
        { scroll: false },
      );
    },
    [props.token, router],
  );

  useEffect(() => {
    const urlStep = parseInt(searchParams.get("step") ?? "1", 10);
    if (Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= 6) {
      setStep(urlStep);
    }
  }, [searchParams]);

  useEffect(() => {
    if (
      searchParams.get("google_connected") ||
      searchParams.get("facebook_connected") ||
      searchParams.get("integration_error")
    ) {
      startTransition(async () => {
        const result = await getOnboardingIntegrationStatus(
          props.churchId,
          props.token,
        );
        if (!("error" in result)) {
          setIntegrations(result);
        }
      });
    }
  }, [searchParams, props.churchId, props.token]);

  useEffect(() => {
    if (step === 6 && !completionDone) {
      startTransition(async () => {
        const result = await completeOnboarding(props.token);
        if (result.ok) {
          setCompletionDone(true);
        } else {
          setError(result.error);
        }
      });
    }
  }, [step, completionDone, props.token]);

  function handleWelcomeNext() {
    goToStep(2);
  }

  function handleAccountNext(data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) {
    if (data.password !== data.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (data.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    startTransition(async () => {
      const result = await createOnboardingAccount(props.token, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAccountCreated(true);
      goToStep(3);
    });
  }

  function handleProfileNext(skipOptional: boolean) {
    startTransition(async () => {
      const result = await updateChurchProfile(props.churchId, props.token, {
        name: profile.name,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zip: profile.zip,
        website: profile.website,
        phone: profile.phone,
        logoUrl: profile.logoUrl || undefined,
        skipOptional,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setProfileSaved(true);
      goToStep(4);
    });
  }

  async function handleLogoUpload(file: File) {
    const formData = new FormData();
    formData.set("logo", file);
    const result = await uploadChurchLogo(
      props.churchId,
      props.token,
      formData,
    );
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setProfile((p) => ({ ...p, logoUrl: result.logoUrl }));
    return result.logoUrl;
  }

  function buildConnectUrl(provider: "google" | "facebook", stepNum: number) {
    const returnTo = `/onboarding?token=${encodeURIComponent(props.token)}&step=${stepNum}`;
    return `/api/integrations/${provider}/connect?token=${encodeURIComponent(props.token)}&return_to=${encodeURIComponent(returnTo)}`;
  }

  return (
    <div className="w-full max-w-[560px]">
      <OnboardingProgress step={step} total={6} labels={STEP_LABELS} />

      <Card
        className={cn(
          "mt-6 overflow-hidden rounded-[20px] border-border shadow-card",
          "px-4 py-8 sm:px-10 sm:py-10",
        )}
      >
        <div key={step} className="onboarding-step-enter">
          {step === 1 && (
            <StepWelcome
              churchName={props.churchName}
              onNext={handleWelcomeNext}
            />
          )}
          {step === 2 && (
            <StepAccount
              adminEmail={props.adminEmail}
              adminFirstName={props.adminFirstName}
              adminLastName={props.adminLastName}
              error={error}
              pending={pending}
              onNext={handleAccountNext}
            />
          )}
          {step === 3 && (
            <StepProfile
              profile={profile}
              onChange={setProfile}
              error={error}
              pending={pending}
              onUpload={handleLogoUpload}
              onNext={() => handleProfileNext(false)}
              onSkip={() => handleProfileNext(true)}
            />
          )}
          {step === 4 && (
            <StepGoogle
              connected={integrations.google.connected}
              email={integrations.google.email}
              connectUrl={buildConnectUrl("google", 4)}
              error={searchParams.get("integration_error")}
              onSkip={() => goToStep(5)}
              onContinue={() => goToStep(5)}
            />
          )}
          {step === 5 && (
            <StepFacebook
              connected={integrations.facebook.connected}
              pageName={integrations.facebook.pageName}
              connectUrl={buildConnectUrl("facebook", 5)}
              error={searchParams.get("integration_error")}
              onSkip={() => goToStep(6)}
              onContinue={() => goToStep(6)}
            />
          )}
          {step === 6 && (
            <StepDone
              churchName={props.churchName}
              accountCreated={accountCreated}
              profileSaved={profileSaved}
              integrations={integrations}
              pending={pending && !completionDone}
              error={error}
            />
          )}
        </div>

        {step > 1 && step < 6 && step !== 2 && step !== 3 && (
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
