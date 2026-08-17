"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  updateChurchAISettings,
  type ChurchSettingsFormState,
} from "@/app/admin/church-settings-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminChurchDetail } from "@/lib/queries/admin";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save AI settings"}
    </Button>
  );
}

export function ChurchAISettingsPanel({
  churchId,
  churchName,
  settings,
}: {
  churchId: string;
  churchName: string;
  settings: AdminChurchDetail["settings"];
}) {
  const [state, formAction] = useFormState<ChurchSettingsFormState, FormData>(
    updateChurchAISettings,
    { ok: false },
  );

  const provider = settings?.aiProvider === "openai" ? "openai" : "anthropic";

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI provider</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Model settings for {churchName}. Churches don&apos;t see these — we
          tune them here.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="church_id" value={churchId} />

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="col-span-full text-sm font-semibold">
              Default model
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="ai_provider"
                value="anthropic"
                defaultChecked={provider === "anthropic"}
                className="size-4"
              />
              <div>
                <p className="font-semibold">Anthropic Claude</p>
                <p className="text-xs text-muted-foreground">
                  Strong for long-form theological writing
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="ai_provider"
                value="openai"
                defaultChecked={provider === "openai"}
                className="size-4"
              />
              <div>
                <p className="font-semibold">OpenAI GPT</p>
                <p className="text-xs text-muted-foreground">
                  Fast, versatile for outlines and snippets
                </p>
              </div>
            </label>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ai_model_override">Model override (optional)</Label>
              <Input
                id="ai_model_override"
                name="ai_model_override"
                defaultValue={settings?.model ?? ""}
                placeholder="e.g. claude-sonnet-4-5-20250929 (blank = default)"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Denomination / tradition</Label>
              <p className="text-sm text-muted-foreground">
                Set on the Profile tab. Sermon AI reads from there.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preaching_style">Preaching style</Label>
              <Input
                id="preaching_style"
                name="preaching_style"
                defaultValue={settings?.preachingStyle ?? ""}
                placeholder="e.g. Expository, narrative, topical"
              />
            </div>
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.ok && (
            <p className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/20 dark:bg-green-500/15 dark:text-green-300">
              AI settings saved.
            </p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
