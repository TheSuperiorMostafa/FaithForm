"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  updateAISettings,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions";
import type { ChurchSettings } from "@/types/sermon";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

export function AISettingsForm({
  settings,
  isAdmin,
}: {
  settings: ChurchSettings | null;
  isAdmin: boolean;
}) {
  const [state, formAction] = useFormState<SettingsFormState, FormData>(
    updateAISettings,
    { ok: false },
  );

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Only church admins and owners can change AI settings. Current
          provider: <strong>{settings?.ai_provider ?? "anthropic"}</strong>.
          Sermon Builder mode:{" "}
          <strong>{settings?.sermon_builder_mode ?? "simple"}</strong>.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI provider</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="col-span-full text-sm font-semibold">Sermon Builder mode</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="sermon_builder_mode"
                value="simple"
                defaultChecked={
                  (settings?.sermon_builder_mode ?? "simple") === "simple"
                }
                className="size-4"
              />
              <div>
                <p className="font-semibold">Simple (recommended)</p>
                <p className="text-xs text-muted-foreground">
                  Pick verses, choose a theme, download a polished slide deck. No
                  AI.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="sermon_builder_mode"
                value="advanced"
                defaultChecked={settings?.sermon_builder_mode === "advanced"}
                className="size-4"
              />
              <div>
                <p className="font-semibold">Advanced (AI)</p>
                <p className="text-xs text-muted-foreground">
                  Generate outlines, manuscripts, discussion guides and social
                  copy.
                </p>
              </div>
            </label>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="col-span-full text-sm font-semibold">Default model</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-background/45 p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input
                type="radio"
                name="ai_provider"
                value="anthropic"
                defaultChecked={
                  (settings?.ai_provider ?? "anthropic") === "anthropic"
                }
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
                defaultChecked={settings?.ai_provider === "openai"}
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
                defaultValue={settings?.ai_model_override ?? ""}
                placeholder="e.g. claude-sonnet-4-5-20250929 (blank = default)"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="denomination">Denomination / tradition</Label>
              <Input
                id="denomination"
                name="denomination"
                defaultValue={settings?.denomination ?? ""}
                placeholder="e.g. Baptist, non-denominational"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preaching_style">Preaching style</Label>
              <Input
                id="preaching_style"
                name="preaching_style"
                defaultValue={settings?.preaching_style ?? ""}
                placeholder="e.g. Expository, narrative, topical"
              />
            </div>
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.ok && (
            <p className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/20 dark:bg-green-500/15 dark:text-green-300">Settings saved.</p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
