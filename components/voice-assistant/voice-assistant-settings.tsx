"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveVoiceAssistantSettings } from "@/app/dashboard/voice-assistant/actions";
import { AvailabilitySection } from "@/components/voice-assistant/availability-section";
import { IdentitySection } from "@/components/voice-assistant/identity-section";
import { KnowledgeBlock } from "@/components/voice-assistant/knowledge-block";
import { PersonalitySection } from "@/components/voice-assistant/personality-section";
import { PhonePreview } from "@/components/voice-assistant/phone-preview";
import { AgentStatusCard } from "@/components/voice-assistant/agent-status-card";
import { SetupChecklist } from "@/components/voice-assistant/setup-checklist";
import { Button } from "@/components/ui/button";
import {
  formsAreEqual,
  getDialInChecklistItem,
  getVoiceAssistantChecklist,
  validateVoiceAssistantForm,
} from "@/lib/utils/voice-assistant-validation";
import type {
  VoiceAgentSyncStatus,
  VoiceAssistantContext,
  VoiceAssistantFormState,
  VoiceProfileSummary,
} from "@/types/voice-assistant";

type VoiceAssistantSettingsProps = {
  initialForm: VoiceAssistantFormState;
  profileSummary: VoiceProfileSummary;
  context: VoiceAssistantContext;
  agentStatus: VoiceAgentSyncStatus;
  isAdmin: boolean;
  isConfigured: boolean;
};

export function VoiceAssistantSettings({
  initialForm,
  profileSummary,
  context,
  agentStatus,
  isAdmin,
  isConfigured,
}: VoiceAssistantSettingsProps) {
  const [form, setForm] = useState(initialForm);
  const [baseline, setBaseline] = useState(initialForm);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, startTransition] = useTransition();
  const assistantNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(initialForm);
    setBaseline(initialForm);
    setShowErrors(false);
  }, [initialForm]);

  useEffect(() => {
    if (!isConfigured) {
      assistantNameRef.current?.focus();
    }
  }, [isConfigured]);

  const errors = useMemo(() => validateVoiceAssistantForm(form), [form]);
  const checklist = useMemo(
    () => [
      ...getVoiceAssistantChecklist(form, profileSummary),
      getDialInChecklistItem(Boolean(agentStatus.phoneNumber?.trim())),
    ],
    [form, profileSummary, agentStatus.phoneNumber],
  );
  const isDirty = !formsAreEqual(form, baseline);
  const isValid = Object.keys(errors).length === 0;

  const patchForm = (patch: Partial<VoiceAssistantFormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (
        typeof patch.assistantName === "string" &&
        patch.assistantName.trim() &&
        patch.assistantName.trim() !== prev.assistantName.trim()
      ) {
        const from = prev.assistantName.trim();
        const to = patch.assistantName.trim();
        if (from) {
          const swap = (value: string) =>
            value.replace(
              new RegExp(
                `\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                "gi",
              ),
              to,
            );
          next.signoffMessage = swap(next.signoffMessage);
          next.afterHoursMessage = swap(next.afterHoursMessage);
        }
      }
      return next;
    });
  };

  const handleDiscard = () => {
    setForm(baseline);
    setShowErrors(false);
  };

  const handleSave = () => {
    if (!isAdmin) return;

    const nextErrors = validateVoiceAssistantForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setShowErrors(true);
      toast.error("Complete the required fields before saving.");
      if ("assistantName" in nextErrors) {
        assistantNameRef.current?.focus();
      }
      return;
    }

    startTransition(async () => {
      const result = await saveVoiceAssistantSettings(form);
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result ? result.error : "Something went wrong. Please try again.",
        );
        return;
      }
      setBaseline(form);
      setShowErrors(false);
      toast.success(
        result.agentId
          ? isConfigured
            ? "Voice assistant updated and synced to Retell."
            : "Assistant created and synced to Retell."
          : "Voice assistant saved.",
      );
    });
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader readOnly />
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <IdentitySection
              assistantName={form.assistantName}
              emergencyPhone={form.emergencyPhone}
              profile={profileSummary}
              readOnly
              onChange={() => {}}
            />
            <PersonalitySection
              tone={form.tone}
              speakingPace={form.speakingPace}
              voiceGender={form.voiceGender}
              language={form.language}
              signoffMessage={form.signoffMessage}
              readOnly
              onChange={() => {}}
            />
            <AvailabilitySection
              profile={profileSummary}
              afterHoursEnabled={form.afterHoursEnabled}
              afterHoursMessage={form.afterHoursMessage}
              readOnly
              onChange={() => {}}
            />
            <KnowledgeBlock context={context} />
            <AgentStatusCard status={agentStatus} />
          </div>
          <aside className="self-start lg:sticky lg:top-6">
            <PhonePreview
              assistantName={form.assistantName}
              greetingMessage={profileSummary.greetingMessage}
              tone={form.tone}
              speakingPace={form.speakingPace}
            />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <PageHeader />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <SetupChecklist items={checklist} isFirstSetup={!isConfigured} />

          <IdentitySection
            assistantName={form.assistantName}
            emergencyPhone={form.emergencyPhone}
            profile={profileSummary}
            assistantNameRef={assistantNameRef}
            errors={errors}
            showErrors={showErrors}
            onChange={patchForm}
          />
          <PersonalitySection
            tone={form.tone}
            speakingPace={form.speakingPace}
            voiceGender={form.voiceGender}
            language={form.language}
            signoffMessage={form.signoffMessage}
            onChange={patchForm}
          />
          <AvailabilitySection
            profile={profileSummary}
            afterHoursEnabled={form.afterHoursEnabled}
            afterHoursMessage={form.afterHoursMessage}
            errors={errors}
            showErrors={showErrors}
            onChange={patchForm}
          />
          <KnowledgeBlock context={context} />
          <AgentStatusCard status={agentStatus} isAdmin />
        </div>

        <aside className="self-start lg:sticky lg:top-6">
          <PhonePreview
            assistantName={form.assistantName}
            greetingMessage={profileSummary.greetingMessage}
            tone={form.tone}
            speakingPace={form.speakingPace}
          />
        </aside>
      </div>

      {isDirty && (
        <div className="fixed inset-x-0 bottom-[4.75rem] z-40 border-t border-border bg-background px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:bottom-0 md:left-64">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Unsaved changes</p>
              <p className="text-xs text-muted-foreground">
                {isValid
                  ? "Ready to sync to your Retell agent."
                  : "Fill required fields before saving."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={handleDiscard}
              >
                Discard
              </Button>
              <Button type="button" disabled={pending} onClick={handleSave}>
                {pending
                  ? "Saving…"
                  : isConfigured
                    ? "Save changes"
                    : "Create assistant"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PageHeader({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {readOnly
        ? "View how your church phone assistant is configured."
        : "Configure voice delivery and after-hours behavior. Church identity lives in Church Profile."}
    </p>
  );
}
