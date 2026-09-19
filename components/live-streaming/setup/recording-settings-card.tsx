"use client";

import { useState, useTransition } from "react";
import { CircleDot } from "lucide-react";
import { toast } from "sonner";

import { saveRecordingSettingsAction } from "@/app/dashboard/live-streaming/recording-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { RecordingSettings } from "@/lib/stream/recording-repo";

/**
 * What happens after a service, decided once.
 *
 * Recording itself is not a setting: every livestream is recorded. What a
 * church chooses is whether a finished recording publishes itself, who sees it
 * by default, and whether members hear about it.
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
  const [settings, setSettings] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);

  const update = <K extends keyof RecordingSettings>(key: K, value: RecordingSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const save = () =>
    startTransition(async () => {
      const result = await saveRecordingSettingsAction(settings);
      if (!result.ok) toast.error(result.error);
      else toast.success("Saved.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleDot className="size-4 text-accent" aria-hidden />
          Recording and publishing
        </CardTitle>
        <CardDescription>
          Every livestream is recorded automatically. Choose what happens once a recording is ready.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!isAdmin || pending} className="flex flex-col divide-y divide-border">
          <legend className="sr-only">Recording and publishing settings</legend>
          <SettingRow
            label="Publish recordings automatically"
            hint="When a recording is ready, FaithForm publishes it for you. Off: you review and press Publish."
            control={
              <Switch
                checked={settings.autoPublish}
                onCheckedChange={(value) => update("autoPublish", value)}
                aria-label="Publish recordings automatically"
              />
            }
          />
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="default-visibility">Who can watch recordings in the app</Label>
            <Select
              id="default-visibility"
              value={settings.defaultVisibility}
              onChange={(event) => update("defaultVisibility", event.target.value as RecordingSettings["defaultVisibility"])}
            >
              <option value="public">Everyone</option>
              <option value="followers">People who follow your church</option>
              <option value="members">Members only</option>
            </Select>
          </div>
          <SettingRow
            label="Also publish to your church website"
            hint="Adds each recording to the Past services on your watch page."
            control={
              <Switch
                checked={settings.publishToWebsite}
                onCheckedChange={(value) => update("publishToWebsite", value)}
                aria-label="Also publish to your church website"
              />
            }
          />
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="default-series">Put new recordings in a series</Label>
            <Select
              id="default-series"
              value={settings.defaultSeriesId ?? ""}
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
            hint="One notification in the Faithful app when your video starts."
            control={
              <Switch
                checked={settings.notifyOnLive}
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
                checked={settings.notifyOnPublish}
                onCheckedChange={(value) => update("notifyOnPublish", value)}
                aria-label="Tell members when a recording is published"
              />
            }
          />
        </fieldset>
        {isAdmin ? (
          <div className="flex justify-end pt-2">
            <Button onClick={save} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SettingRow({ label, hint, control }: { label: string; hint: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {control}
    </div>
  );
}
