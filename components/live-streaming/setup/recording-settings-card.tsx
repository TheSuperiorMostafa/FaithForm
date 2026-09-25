"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Eye, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { saveRecordingSettingsAction } from "@/app/dashboard/live-streaming/recording-actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import { MEMBER_APP } from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

/**
 * Step 3 of Set up streaming: what happens after the service.
 *
 * Recording itself is not a setting — every livestream is recorded. The one
 * decision most churches make is whether a finished recording publishes
 * itself or waits for someone to review it (the church's `autoPublish`
 * setting; off by default). It saves the moment it is chosen. Who sees it,
 * the website, a default series and notifications sit under "More publishing
 * options".
 */
export function RecordingSettingsCard({
  initial,
  series,
  isAdmin,
}: {
  initial: RecordingSettings;
  series: Array<{ id: string; name: string }>;
  isAdmin: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty =
    JSON.stringify({ ...draft, autoPublish: saved.autoPublish }) !== JSON.stringify(saved);

  const update = <K extends keyof RecordingSettings>(key: K, value: RecordingSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const chooseAutoPublish = (autoPublish: boolean) => {
    if (autoPublish === saved.autoPublish || !isAdmin) return;
    const next = { ...saved, autoPublish };
    setDraft((current) => ({ ...current, autoPublish }));
    startTransition(async () => {
      const result = await saveRecordingSettingsAction(next);
      if (!result.ok) {
        toast.error(result.error);
        setDraft((current) => ({ ...current, autoPublish: saved.autoPublish }));
        return;
      }
      setSaved(next);
      toast.success(
        autoPublish
          ? `Saved. New recordings will publish to the ${MEMBER_APP} by themselves.`
          : "Saved. New recordings will wait for you to review and publish them.",
      );
    });
  };

  const saveMore = () =>
    startTransition(async () => {
      const next = { ...draft, autoPublish: saved.autoPublish };
      const result = await saveRecordingSettingsAction(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(next);
      toast.success("Publishing options saved.");
    });

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="After the service" className="grid gap-3 sm:grid-cols-2">
        <Choice
          selected={draft.autoPublish}
          disabled={!isAdmin || pending}
          onSelect={() => chooseAutoPublish(true)}
          icon={<Send className="size-5" aria-hidden />}
          title="Publish to the app automatically"
          description={`When the recording is ready, members see it in the ${MEMBER_APP} under Services. No clicks needed.`}
        />
        <Choice
          selected={!draft.autoPublish}
          disabled={!isAdmin || pending}
          onSelect={() => chooseAutoPublish(false)}
          icon={<Eye className="size-5" aria-hidden />}
          title="Let me review first"
          description="We'll tell you on the Go live tab when it's ready. You check it, then press Publish."
        />
      </div>
      {!isAdmin ? (
        <p className="text-[15px] text-muted-foreground">A church admin can change this.</p>
      ) : null}

      <AdvancedSection title="More publishing options" description="Who can watch, your website, series and notifications">
        <fieldset disabled={!isAdmin || pending} className="flex flex-col divide-y divide-border">
          <legend className="sr-only">More publishing options</legend>
          <div className="flex flex-col gap-2 pb-4">
            <Label htmlFor="default-visibility" className="text-[15px]">
              Who can watch recordings in the app
            </Label>
            <Select
              id="default-visibility"
              value={draft.defaultVisibility}
              onChange={(event) =>
                update("defaultVisibility", event.target.value as RecordingSettings["defaultVisibility"])
              }
            >
              <option value="public">Everyone</option>
              <option value="followers">People who follow your church</option>
              <option value="members">Members only</option>
            </Select>
          </div>
          <SettingRow
            label="Also publish to your church website"
            hint="Adds each recording to Past services on your watch page."
            control={
              <Switch
                checked={draft.publishToWebsite}
                onCheckedChange={(value) => update("publishToWebsite", value)}
                aria-label="Also publish to your church website"
              />
            }
          />
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="default-series" className="text-[15px]">
              Put new recordings in a series
            </Label>
            <Select
              id="default-series"
              value={draft.defaultSeriesId ?? ""}
              onChange={(event) => update("defaultSeriesId", event.target.value || null)}
            >
              <option value="">No series</option>
              {series.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
          <SettingRow
            label="Tell members when you go live"
            hint={`One notification in the ${MEMBER_APP} when your video starts.`}
            control={
              <Switch
                checked={draft.notifyOnLive}
                onCheckedChange={(value) => update("notifyOnLive", value)}
                aria-label="Tell members when you go live"
              />
            }
          />
          <SettingRow
            label="Tell members when a recording is published"
            hint="“Sunday Worship is now available to watch.” Sent once per recording."
            control={
              <Switch
                checked={draft.notifyOnPublish}
                onCheckedChange={(value) => update("notifyOnPublish", value)}
                aria-label="Tell members when a recording is published"
              />
            }
          />
        </fieldset>
        {isAdmin ? (
          <Button onClick={saveMore} disabled={!dirty || pending} className="w-fit gap-2">
            {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
            Save publishing options
          </Button>
        ) : null}
      </AdvancedSection>
    </div>
  );
}

function Choice({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-28 flex-col gap-2 rounded-2xl border-2 p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none",
        selected ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-accent/50",
        disabled && !selected && "opacity-70",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-base font-semibold">
          <span className="text-accent">{icon}</span>
          {title}
        </span>
        {selected ? <CheckCircle2 className="size-5 shrink-0 text-accent" aria-hidden /> : null}
      </span>
      <span className="text-[15px] leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

function SettingRow({ label, hint, control }: { label: string; hint: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
      {control}
    </div>
  );
}
