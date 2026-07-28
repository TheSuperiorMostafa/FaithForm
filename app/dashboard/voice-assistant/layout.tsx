import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

const voiceAssistantTabs: SectionLinkTab[] = [
  {
    label: "Assistant",
    href: "/dashboard/voice-assistant",
    match: "exact",
  },
  {
    label: "Call Log",
    href: "/dashboard/voice-assistant/calls",
    match: "prefix",
  },
];

export default function VoiceAssistantLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <FeatureGate feature="voice_assistant">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Voice Assistant
          </h1>
        </header>

        <SectionLinkTabs tabs={voiceAssistantTabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
