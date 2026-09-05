import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUserId } from "@/lib/auth/superadmin";

/**
 * Assistant configuration — ours to hold, not the church's.
 *
 * Nothing on these pages is a decision a pastor asked to make. The persona, the
 * voice, the knowledge the agent answers from and the Retell agent it is bound
 * to are all things we set up during onboarding and then maintain; leaving them
 * in the church's own nav produced exactly one kind of event, which was a
 * setting changed by accident and a support ticket about the phone sounding
 * wrong. The church keeps the Call Log, which is the part they actually read.
 *
 * A platform admin reaches this by stepping into the church from the control
 * center, so the page still renders inside that church's own dashboard with
 * that church's data. Anyone else is sent to the log.
 */
export default async function VoiceAssistantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  // Stepping in already proved platform-admin membership this request, so the
  // extra lookup is only for an admin who happens to belong to a church too.
  const isPlatformAdmin =
    Boolean(auth.impersonation) || (await isPlatformAdminUserId(auth.userId));

  if (!isPlatformAdmin) {
    redirect("/dashboard/call-log");
  }

  return (
    <FeatureGate feature="voice_assistant">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Voice Assistant
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform admin only. The church sees the Call Log, not these
            settings.
          </p>
        </header>

        {children}
      </div>
    </FeatureGate>
  );
}
