"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import {
  saveVoiceAgentLink,
  type VoiceAgentFormState,
} from "@/app/admin/voice-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentMode, VoiceAssistantSettings } from "@/types/voice-assistant";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function ChurchVoiceAgentPanel({
  churchId,
  settings,
  hasRetellKey,
}: {
  churchId: string;
  settings: VoiceAssistantSettings | null;
  hasRetellKey: boolean;
}) {
  const [state, formAction] = useFormState<VoiceAgentFormState, FormData>(
    saveVoiceAgentLink,
    { ok: false },
  );

  const initialMode: AgentMode = settings?.agent_mode ?? "managed";
  const [mode, setMode] = useState<AgentMode>(initialMode);
  const wasLinked = initialMode === "linked";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Retell agent</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          For a church whose AI phone agent was hand-built directly in Retell
          before FaithForm existed. Linking connects call logs, transcripts,
          and scoring to this dashboard — FaithForm never pushes a prompt or
          configuration change to a linked agent.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="church_id" value={churchId} />

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="col-span-full text-sm font-semibold">
              Agent mode
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="agent_mode"
                value="managed"
                checked={mode === "managed"}
                onChange={() => setMode("managed")}
                className="size-4"
              />
              <div>
                <p className="font-semibold">Managed</p>
                <p className="text-xs text-muted-foreground">
                  FaithForm creates and updates the agent from Church Profile.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="agent_mode"
                value="linked"
                checked={mode === "linked"}
                onChange={() => setMode("linked")}
                className="size-4"
              />
              <div>
                <p className="font-semibold">Linked</p>
                <p className="text-xs text-muted-foreground">
                  The agent already exists in Retell. FaithForm reads call
                  logs, transcripts, and scoring, but never writes to it.
                </p>
              </div>
            </label>
          </fieldset>

          {mode === "linked" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="retell_agent_id">Retell agent ID</Label>
                <Input
                  id="retell_agent_id"
                  name="retell_agent_id"
                  required
                  defaultValue={settings?.retail_ai_agent_id ?? ""}
                  placeholder="agent_xxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="retell_api_key">
                  Church&apos;s Retell API key (optional)
                </Label>
                <Input
                  id="retell_api_key"
                  name="retell_api_key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    hasRetellKey
                      ? "Key saved — leave blank to keep it"
                      : "Only if the agent lives in the church's own Retell account"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {hasRetellKey
                    ? "A key is already saved for this church."
                    : "Leave blank to use FaithForm's shared Retell account."}{" "}
                  Write-only — it is never shown again once saved.
                </p>
              </div>
            </div>
          ) : wasLinked ? (
            <p className="rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300">
              Switching back to managed mode lets FaithForm resume
              overwriting this agent&apos;s prompt and configuration from
              Church Profile on the next save.
            </p>
          ) : null}

          {settings?.retail_ai_agent_id && (
            <p className="text-xs text-muted-foreground">
              Currently saved agent ID:{" "}
              <span className="font-mono">{settings.retail_ai_agent_id}</span>
            </p>
          )}

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.ok && (
            <p className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/20 dark:bg-green-500/15 dark:text-green-300">
              Saved.
            </p>
          )}

          <div>
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
