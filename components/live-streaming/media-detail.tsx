"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  setMediaSeries,
  updateMediaDetails,
} from "@/app/dashboard/live-streaming/media/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  MediaItem,
  MediaSeries,
  MediaStats,
  MediaVisibility,
} from "@/lib/stream/media-library";
import { cn } from "@/lib/utils";

type MediaDetailProps = {
  item: MediaItem;
  series: MediaSeries[];
  stats: MediaStats;
  playbackUrl: string | null;
  /** Public page for this service, when the church has a URL slug. */
  shareUrl: string | null;
  isAdmin: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** A labelled list of free-text tags with add/remove. */
function TagField({
  label,
  hint,
  values,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={disabled}
          placeholder={hint}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || !draft.trim()}
          aria-label={`Add ${label.toLowerCase()}`}
          onClick={add}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-xs"
            >
              {value}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-heading text-2xl font-bold text-foreground">
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function MediaDetail({
  item,
  series,
  stats,
  playbackUrl,
  shareUrl,
  isAdmin,
}: MediaDetailProps) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  const [title, setTitle] = useState(item.title ?? "");
  const [visibility, setVisibility] = useState<MediaVisibility>(item.visibility);
  const [speakers, setSpeakers] = useState(item.tags.speakers);
  const [chapters, setChapters] = useState(item.tags.chapters);
  const [topics, setTopics] = useState(item.tags.topics);

  const [seriesId, setSeriesId] = useState(item.seriesId ?? "");
  const [newSeries, setNewSeries] = useState("");

  function handleSaveDetails() {
    startSaving(async () => {
      const result = await updateMediaDetails({
        recordingId: item.id,
        title,
        visibility,
        speakers,
        chapters,
        topics,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved.");
      router.refresh();
    });
  }

  function handleSaveSeries() {
    startSaving(async () => {
      const result = await setMediaSeries({
        recordingId: item.id,
        seriesId: seriesId || null,
        newSeriesName: newSeries.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNewSeries("");
      toast.success("Series updated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-xl font-bold">
            {item.title ?? "Service recording"}
          </h2>
          <Badge variant={item.visibility === "public" ? "secondary" : "outline"}>
            {item.visibility === "public" ? "Public" : "Unlisted"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(item.createdAt)}
          {item.seriesName ? ` · ${item.seriesName}` : ""}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {playbackUrl ? (
            <video
              className="aspect-video w-full rounded-xl bg-black"
              src={playbackUrl}
              controls
              preload="none"
              playsInline
            />
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              This broadcast&apos;s video file never reached FaithForm, so
              there&apos;s nothing to play back.
            </p>
          )}
        </CardContent>
      </Card>

      {shareUrl && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Share link
            </p>
            <p className="truncate font-mono text-xs text-foreground">
              {shareUrl}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              toast.success("Link copied.");
            }}
          >
            Copy
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analytics</CardTitle>
          <p className="text-sm text-muted-foreground">
            Watching live and watching it back are counted separately.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile value={stats.liveViews} label="Plays during the service" />
              <StatTile
                value={stats.liveUniqueViewers}
                label="Unique viewers live"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              After the service
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile value={stats.replayViews} label="Total plays" />
              <StatTile
                value={stats.replayUniqueViewers}
                label="Unique viewers"
              />
              <StatTile
                value={stats.replayBySource.website}
                label="From the website"
              />
              <StatTile value={stats.replayBySource.app} label="From the app" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="media-title">Title</Label>
            <Input
              id="media-title"
              value={title}
              disabled={!isAdmin}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunday morning service"
            />
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "public" as const,
                    icon: Eye,
                    title: "Public",
                    detail: "Listed on your watch page for anyone to find.",
                  },
                  {
                    value: "unlisted" as const,
                    icon: EyeOff,
                    title: "Unlisted",
                    detail: "Only reachable by people you send the link to.",
                  },
                ]
              ).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => setVisibility(option.value)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                      visibility === option.value
                        ? "border-accent bg-accent/10"
                        : "border-border hover:border-accent/50",
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="size-4" strokeWidth={1.75} />
                      {option.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {option.detail}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <TagField
            label="Speakers"
            hint="e.g. Pastor Dan"
            values={speakers}
            onChange={setSpeakers}
            disabled={!isAdmin}
          />
          <TagField
            label="Chapter of the Bible"
            hint="e.g. John 3"
            values={chapters}
            onChange={setChapters}
            disabled={!isAdmin}
          />
          <TagField
            label="Topic of sermon"
            hint="e.g. Grace"
            values={topics}
            onChange={setTopics}
            disabled={!isAdmin}
          />

          {isAdmin && (
            <div>
              <Button type="button" disabled={saving} onClick={handleSaveDetails}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save details
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Series</CardTitle>
          <p className="text-sm text-muted-foreground">
            Group services that belong together.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="media-series">In a series</Label>
            <Select
              id="media-series"
              value={seriesId}
              disabled={!isAdmin}
              onChange={(e) => setSeriesId(e.target.value)}
            >
              <option value="">Not in a series</option>
              {series.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="media-new-series">Or start a new one</Label>
            <Input
              id="media-new-series"
              value={newSeries}
              disabled={!isAdmin}
              placeholder="e.g. Advent 2026"
              onChange={(e) => setNewSeries(e.target.value)}
            />
          </div>

          {isAdmin && (
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={handleSaveSeries}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {newSeries.trim() ? "Create and add" : "Save series"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
