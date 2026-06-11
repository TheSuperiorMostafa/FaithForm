"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveVoiceAssistantSettings } from "@/app/dashboard/voice-assistant/actions";
import { AvailabilitySection } from "@/components/voice-assistant/availability-section";
import { EmptyState } from "@/components/voice-assistant/empty-state";
import { IdentitySection } from "@/components/voice-assistant/identity-section";
import { KnowledgeBlock } from "@/components/voice-assistant/knowledge-block";
import { PersonalitySection } from "@/components/voice-assistant/personality-section";
import { PhonePreview } from "@/components/voice-assistant/phone-preview";
import { AgentStatusCard } from "@/components/voice-assistant/agent-status-card";
import { RecentCallsBlock } from "@/components/voice-assistant/recent-calls-block";
import { Button } from "@/components/ui/button";
import type {
  PhoneCallRow,
  VoiceAgentSyncStatus,
  VoiceAssistantContext,
  VoiceAssistantFormState,
} from "@/types/voice-assistant";

type VoiceAssistantSettingsProps = {
  initialForm: VoiceAssistantFormState;
  context: VoiceAssistantContext;
  recentCalls: PhoneCallRow[];
  agentStatus: VoiceAgentSyncStatus;
  isAdmin: boolean;
  isConfigured: boolean;
};

export function VoiceAssistantSettings({
  initialForm,
  context,
  recentCalls,
  agentStatus,
  isAdmin,
  isConfigured,
}: VoiceAssistantSettingsProps) {
  const [form, setForm] = useState(initialForm);
  const [pending, startTransition] = useTransition();
  const assistantNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isConfigured) {
      assistantNameRef.current?.focus();
    }
  }, [isConfigured]);

  const patchForm = (patch: Partial<VoiceAssistantFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    if (!isAdmin) return;

    startTransition(async () => {
      const result = await saveVoiceAssistantSettings(form);
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result ? result.error : "Something went wrong. Please try again.",
        );
        return;
      }
      toast.success(
        result.agentId
          ? "Voice assistant updated and synced to Retell."
          : "Voice assistant updated.",
      );
    });
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader readOnly />
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-6">
            <IdentitySection
              assistantName={form.assistantName}
              denomination={form.denomination}
              churchPhone={form.churchPhone}
              emergencyPhone={form.emergencyPhone}
              readOnly
              onChange={() => {}}
            />
            <PersonalitySection
              tone={form.tone}
              speakingPace={form.speakingPace}
              language={form.language}
              greetingMessage={form.greetingMessage}
              signoffMessage={form.signoffMessage}
              readOnly
              onChange={() => {}}
            />
            <AvailabilitySection
              officeHours={form.officeHours}
              afterHoursEnabled={form.afterHoursEnabled}
              afterHoursMessage={form.afterHoursMessage}
              readOnly
              onChange={() => {}}
            />
            <KnowledgeBlock context={context} />
            <RecentCallsBlock
              calls={recentCalls}
              isAdmin={false}
              hasAgent={Boolean(agentStatus.agentId)}
            />
          </div>
          <div className="flex flex-col gap-6">
            <PhonePreview
              assistantName={form.assistantName}
              greetingMessage={form.greetingMessage}
              tone={form.tone}
              speakingPace={form.speakingPace}
            />
            <AgentStatusCard status={agentStatus} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader onSave={handleSave} pending={pending} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {!isConfigured && <EmptyState />}

          <IdentitySection
            assistantName={form.assistantName}
            denomination={form.denomination}
            churchPhone={form.churchPhone}
            emergencyPhone={form.emergencyPhone}
            assistantNameRef={assistantNameRef}
            onChange={patchForm}
          />
          <PersonalitySection
            tone={form.tone}
            speakingPace={form.speakingPace}
            language={form.language}
            greetingMessage={form.greetingMessage}
            signoffMessage={form.signoffMessage}
            onChange={patchForm}
          />
          <AvailabilitySection
            officeHours={form.officeHours}
            afterHoursEnabled={form.afterHoursEnabled}
            afterHoursMessage={form.afterHoursMessage}
            onChange={patchForm}
          />
          <KnowledgeBlock context={context} />
          <RecentCallsBlock
            calls={recentCalls}
            isAdmin={isAdmin}
            hasAgent={Boolean(agentStatus.agentId)}
          />
        </div>

        <div className="flex flex-col gap-6">
          <PhonePreview
            assistantName={form.assistantName}
            greetingMessage={form.greetingMessage}
            tone={form.tone}
            speakingPace={form.speakingPace}
          />
          <AgentStatusCard status={agentStatus} />
        </div>
      </div>
    </div>
  );
}

function PageHeader({
  onSave,
  pending = false,
  readOnly = false,
}: {
  onSave?: () => void;
  pending?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-5 flex items-center justify-between gap-4 border-b border-border bg-background/90 px-5 py-4 backdrop-blur md:-mx-8 md:px-8">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Voice Assistant
        </h1>
        <p className="text-sm text-muted-foreground">
          {readOnly
            ? "View how your church phone assistant is configured."
            : "Set up your AI phone answering agent for callers."}
        </p>
      </div>
      {!readOnly && onSave && (
        <Button onClick={onSave} disabled={pending} className="shrink-0">
          {pending ? "Saving…" : "Save Changes"}
        </Button>
      )}
    </div>
  );
}
