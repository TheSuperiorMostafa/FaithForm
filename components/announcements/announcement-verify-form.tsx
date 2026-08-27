"use client";

import { useCallback, useState, useTransition } from "react";
import { Calendar, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { publishAnnouncement } from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarQueueItem, AnnouncementRow } from "@/lib/queries/announcements";
import {
  fromDateInputValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  toDatetimeLocalValue,
} from "@/lib/utils/announcement-placeholders";

type IntegrationDefaults = {
  googleConnected: boolean;
  facebookConnected: boolean;
};

type SocialPreviewPayload = {
  headline: string;
  facebookCaption: string;
  graphicUrl: string;
  graphicPath: string;
  warning?: string;
};

type AnnouncementVerifyFormProps = {
  churchId: string;
  event: CalendarQueueItem;
  defaults: IntegrationDefaults;
  publishedAnnouncementId?: string | null;
  onPublished?: (announcement: AnnouncementRow) => void;
  compact?: boolean;
};

export function AnnouncementVerifyForm({
  churchId,
  event,
  defaults,
  publishedAnnouncementId,
  onPublished,
  compact = false,
}: AnnouncementVerifyFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  // An all-day event has no time anyone chose — it is a date, and it is edited
  // as one. Feeding its midnight-UTC instant to a datetime-local picker showed
  // the evening before in any western zone, and saving that shifted the event a
  // day earlier.
  const allDay = Boolean(event.allDay);

  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location);
  const [startAt, setStartAt] = useState(
    allDay
      ? toDateInputValue(event.startAt)
      : toDatetimeLocalValue(event.startAt),
  );
  const [endAt, setEndAt] = useState(
    !allDay && event.endAt ? toDatetimeLocalValue(event.endAt) : "",
  );
  const [notes, setNotes] = useState("");
  const [pushToFacebook, setPushToFacebook] = useState(false);
  const [pushToTeam, setPushToTeam] = useState(true);

  const [facebookCaption, setFacebookCaption] = useState("");
  const [socialGraphicUrl, setSocialGraphicUrl] = useState<string | null>(null);
  const [socialGraphicPath, setSocialGraphicPath] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);

  const fetchSocialPreview = useCallback(async () => {
    const startIso = allDay
      ? fromDateInputValue(startAt)
      : fromDatetimeLocalValue(startAt);
    if (!startIso || !title.trim()) {
      setPreviewError("Add a title and start time to generate a Facebook preview.");
      return;
    }

    const endIso = !allDay && endAt ? fromDatetimeLocalValue(endAt) : null;

    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewWarning(null);

    try {
      const res = await fetch("/api/announcements/social-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          location: location.trim(),
          startAt: startIso,
          endAt: endIso,
          allDay,
          notes: notes.trim() || undefined,
          googleEventId: event.googleEventId,
          announcementId: publishedAnnouncementId ?? undefined,
        }),
      });

      const data = (await res.json()) as {
        preview?: SocialPreviewPayload;
        error?: string;
      };

      if (!res.ok || !data.preview) {
        throw new Error(data.error ?? "Could not generate Facebook preview");
      }

      setFacebookCaption(data.preview.facebookCaption);
      setSocialGraphicUrl(data.preview.graphicUrl);
      setSocialGraphicPath(data.preview.graphicPath);
      setPreviewWarning(data.preview.warning ?? null);
      setPreviewStale(false);
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : "Could not generate Facebook preview",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [
    allDay,
    startAt,
    endAt,
    title,
    location,
    notes,
    event.googleEventId,
    publishedAnnouncementId,
  ]);

  const handleFacebookToggle = (checked: boolean) => {
    setPushToFacebook(checked);
    if (checked && defaults.facebookConnected) {
      void fetchSocialPreview();
    }
    if (!checked) {
      setPreviewError(null);
      setPreviewWarning(null);
      setPreviewStale(false);
    }
  };

  const markPreviewStale = () => {
    if (pushToFacebook && socialGraphicPath) {
      setPreviewStale(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const startIso = allDay
      ? fromDateInputValue(startAt)
      : fromDatetimeLocalValue(startAt);
    if (!startIso) {
      setError(allDay ? "Event date is required" : "Start time is required");
      return;
    }
    const endIso = !allDay && endAt ? fromDatetimeLocalValue(endAt) : null;

    if (pushToFacebook && !facebookCaption.trim()) {
      setError("Generate or enter a Facebook caption before publishing.");
      return;
    }

    if (pushToFacebook && !socialGraphicPath) {
      setError("Generate a Facebook graphic before publishing.");
      return;
    }

    // The graphic has the date and time baked into the image by the model, so
    // publishing after an edit would post a flyer announcing the old ones.
    if (pushToFacebook && previewStale) {
      setError(
        "The event changed after this graphic was made — regenerate it before publishing.",
      );
      return;
    }

    const formData = new FormData();
    formData.set("church_id", churchId);
    formData.set("title", title.trim());
    formData.set("location", location.trim());
    formData.set("start_at", startIso);
    if (endIso) formData.set("end_at", endIso);
    formData.set("all_day", allDay ? "true" : "false");
    formData.set("notes", notes);
    formData.set("google_event_id", event.googleEventId);
    formData.set("google_calendar_id", event.calendarId);
    if (publishedAnnouncementId) {
      formData.set("announcement_id", publishedAnnouncementId);
    }
    formData.set("push_to_facebook", pushToFacebook ? "true" : "false");
    formData.set("push_to_team", pushToTeam ? "true" : "false");
    formData.set("original_title", event.title);
    formData.set("original_location", event.location);
    formData.set("original_start_at", event.startAt);
    formData.set("original_end_at", event.endAt ?? "");
    if (pushToFacebook) {
      formData.set("facebook_caption", facebookCaption.trim());
      formData.set("social_graphic_path", socialGraphicPath ?? "");
      if (socialGraphicUrl) {
        formData.set("social_graphic_url", socialGraphicUrl);
      }
    }

    startTransition(async () => {
      const result = await publishAnnouncement(formData);
      if (!result.ok) {
        setError(result.errors.join(" "));
        return;
      }

      const parts: string[] = ["Submitted!"];
      if (result.facebookScheduledAt) {
        parts.push(
          `Facebook post scheduled for ${new Date(result.facebookScheduledAt).toLocaleString()}.`,
        );
      } else if (result.facebookUrl) {
        parts.push("Posted to Facebook.");
      }
      if (result.queuedForWeeklyEmail) {
        parts.push("Queued for this week's team email.");
      }
      if (result.errors.length > 0) {
        parts.push(result.errors.join(" "));
      }
      if (!result.announcementId) return;

      setSuccess(parts.join(" "));
      onPublished?.({
        id: result.announcementId,
        church_id: churchId,
        title: title.trim(),
        body: notes,
        start_at: startIso,
        end_at: endIso,
        all_day: allDay,
        event_location: location.trim() || null,
        is_ready: true,
        push_to_app: false,
        push_to_facebook: pushToFacebook,
        push_to_team: pushToTeam,
        status: "published",
        google_event_id: event.googleEventId,
        google_calendar_id: event.calendarId,
        facebook_post_id: result.facebookUrl ? "posted" : null,
        gmail_draft_id: null,
        published_at: new Date().toISOString(),
        last_publish_error:
          result.errors.length > 0 ? result.errors.join(" ") : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "flex flex-col gap-4" : "flex flex-col gap-5"}
    >
      {!compact && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-sm font-medium text-muted-foreground">
          <Calendar className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
          Prefilled from your calendar
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`title-${event.googleEventId}`}>Title</Label>
        <Input
          id={`title-${event.googleEventId}`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markPreviewStale();
          }}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`where-${event.googleEventId}`}>Where</Label>
        <Input
          id={`where-${event.googleEventId}`}
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            markPreviewStale();
          }}
          placeholder="Location"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={allDay ? `date-${event.googleEventId}` : undefined}>
          When
        </Label>
        {allDay ? (
          <div className="flex flex-col gap-1">
            <Input
              id={`date-${event.googleEventId}`}
              type="date"
              value={startAt}
              onChange={(e) => {
                setStartAt(e.target.value);
                markPreviewStale();
              }}
              required
              className="w-full min-w-0 tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              All-day event — no start or end time.
            </p>
          </div>
        ) : (
          /* Two columns only once there is room for both pickers. A
              `datetime-local` control is intrinsically wide, so side-by-side in a
              narrow card (this form renders inside a queue row) made the two
              overlap. `min-w-0` lets each shrink to its share of the grid. */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor={`start-${event.googleEventId}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Start
              </label>
              <Input
                id={`start-${event.googleEventId}`}
                type="datetime-local"
                value={startAt}
                onChange={(e) => {
                  setStartAt(e.target.value);
                  markPreviewStale();
                }}
                required
                className="w-full min-w-0 tabular-nums"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label
                htmlFor={`end-${event.googleEventId}`}
                className="text-xs font-medium text-muted-foreground"
              >
                End
              </label>
              <Input
                id={`end-${event.googleEventId}`}
                type="datetime-local"
                value={endAt}
                onChange={(e) => {
                  setEndAt(e.target.value);
                  markPreviewStale();
                }}
                className="w-full min-w-0 tabular-nums"
              />
            </div>
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        <ToggleRow
          id={`fb-${event.googleEventId}`}
          label="Shared to FB?"
          checked={pushToFacebook}
          onCheckedChange={handleFacebookToggle}
          disabled={!defaults.facebookConnected}
          hint={
            defaults.facebookConnected
              ? "Creates a Facebook post with an AI caption and branded graphic. Schedules for the day before the event at your Church Profile post time."
              : "Connect Facebook in Settings"
          }
        />
        <ToggleRow
          id={`team-${event.googleEventId}`}
          label="Include in weekly email?"
          checked={pushToTeam}
          onCheckedChange={setPushToTeam}
          disabled={!defaults.googleConnected}
          hint={
            defaults.googleConnected
              ? "Adds this event to Monday's Gmail draft with the rest of this week's calendar."
              : "Connect Google in Settings"
          }
        />
      </ul>

      {pushToFacebook && defaults.facebookConnected && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Facebook preview</p>
              <p className="text-xs text-muted-foreground">
                Edit the caption or regenerate if event details changed.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchSocialPreview()}
              disabled={previewLoading}
            >
              <RefreshCw
                className={`mr-2 size-4 ${previewLoading ? "animate-spin" : ""}`}
              />
              {previewLoading ? "Generating…" : "Regenerate"}
            </Button>
          </div>

          {previewStale && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Event details changed — regenerate for an updated graphic and caption.
            </p>
          )}

          {previewError && (
            <p className="text-sm text-destructive" role="alert">
              {previewError}
            </p>
          )}

          {previewWarning && (
            <p className="text-xs text-muted-foreground">{previewWarning}</p>
          )}

          {previewLoading && !socialGraphicUrl && (
            <div className="aspect-[1200/630] w-full animate-pulse rounded-md bg-muted" />
          )}

          {socialGraphicUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={socialGraphicUrl}
              alt="Facebook post graphic preview"
              className="w-full rounded-md border border-border"
            />
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`fb-caption-${event.googleEventId}`}>
              Facebook caption
            </Label>
            <Textarea
              id={`fb-caption-${event.googleEventId}`}
              value={facebookCaption}
              onChange={(e) => setFacebookCaption(e.target.value)}
              placeholder={
                previewLoading
                  ? "Generating caption…"
                  : "Your Facebook post caption will appear here."
              }
              rows={6}
              disabled={previewLoading && !facebookCaption}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setShowNotes((v) => !v)}
      >
        {showNotes ? (
          <ChevronUp className="size-4" strokeWidth={1.75} />
        ) : (
          <ChevronDown className="size-4" strokeWidth={1.75} />
        )}
        Add details (optional)
      </button>
      {showNotes && (
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            markPreviewStale();
          }}
          placeholder="Extra notes for email or Facebook…"
          rows={3}
        />
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-green-200 bg-green-100 px-3 py-2 text-sm font-semibold text-green-700 dark:border-green-500/20 dark:bg-green-500/15 dark:text-green-300" role="status">
          {success}
        </p>
      )}

      <Button type="submit" disabled={pending || (pushToFacebook && previewLoading)} className="w-full">
        {pending ? "Submitting…" : "Verify & submit"}
      </Button>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="flex items-baseline gap-2 font-semibold">
          <span aria-hidden className="text-accent">
            •
          </span>
          <span>{label}</span>
        </Label>
        {hint && (
          <p className="mt-0.5 pl-4 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </li>
  );
}
