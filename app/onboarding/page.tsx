import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { OnboardingErrorCard } from "@/components/onboarding/onboarding-error-card";
import {
  getOnboardingIntegrationStatus,
  validateInviteToken,
} from "@/app/onboarding/actions";

type PageProps = {
  searchParams: { token?: string; step?: string };
};

export default async function OnboardingPage({ searchParams }: PageProps) {
  const token = searchParams.token ?? "";
  const stepParam = parseInt(searchParams.step ?? "1", 10);
  const initialStep = Number.isFinite(stepParam)
    ? Math.min(6, Math.max(1, stepParam))
    : 1;

  const result = await validateInviteToken(token);

  if (!result.ok) {
    if (result.code === "already_accepted") {
      const { redirect } = await import("next/navigation");
      redirect("/login?notice=setup_complete");
    }
    return (
      <OnboardingErrorCard
        title={
          result.code === "expired"
            ? "Invite expired"
            : "Invalid invite"
        }
        message={result.message}
      />
    );
  }

  const { invite } = result;
  const integrationResult = await getOnboardingIntegrationStatus(
    invite.churchId,
    token,
  );

  const integrationStatus =
    "error" in integrationResult
      ? {
          google: { connected: false, email: null as string | null },
          facebook: { connected: false, pageName: null as string | null },
        }
      : integrationResult;

  return (
    <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
      <OnboardingWizard
        token={token}
        churchId={invite.churchId}
        churchName={invite.church.name}
        adminEmail={invite.email}
        adminFirstName={invite.adminFirstName}
        adminLastName={invite.adminLastName}
        initialStep={initialStep}
        initialProfile={{
          name: invite.church.name,
          address: invite.church.address ?? "",
          city: invite.church.city ?? "",
          state: invite.church.state ?? "",
          zip: invite.church.zip ?? "",
          website: invite.church.website ?? "",
          phone: invite.church.phone ?? "",
          logoUrl: invite.church.logoUrl ?? "",
        }}
        integrationStatus={integrationStatus}
      />
    </Suspense>
  );
}
