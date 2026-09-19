"use client";

import { useCallback, useReducer, useRef, useState, useTransition } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  RefreshCw,
  Smartphone,
  Sparkles,
} from "lucide-react";
import {
  getFacebookPostDefaults,
  publishAnnouncement,
} from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  checkFacebookScheduleTime,
  DEFAULT_FACEBOOK_POST_TIME,
  describeFacebookPostTime,
  describeTimeZone,
  fromZonedInputValue,
  suggestFacebookSchedule,
  toZonedInputValue,
  type FacebookPostMode,
  type FacebookScheduleSuggestion,
} from "@/lib/announcements/facebook-schedule";
import type { CalendarQueueItem, AnnouncementRow } from "@/lib/queries/announcements";
import { hasLeftAppFeed } from "@/lib/faithform/feed-window";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import {
  fromDateInputValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  toDatetimeLocalValue,
} from "@/lib/utils/announcement-placeholders";

type IntegrationDefaults = {
  googleConnected: boolean;
  facebookConnected: boolean;
  /**
   * Whether the church has a way to send the weekly email: Google, or Apple.
   * Callers that predate Apple email leave it out, and Google decides alone.
   */
  emailAvailable?: boolean;
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

/** The image posted to Facebook, which is also the app poster. */
type Graphic = { url: string; path: string; source: "ai" | "upload" };

type GraphicState = {
  current: Graphic | null;
  /** The last AI flyer, kept while the church's own image shows so switching back is instant. */
  setAsideAi: Graphic | null;
  /** The AI flyer on screen has old event details drawn into it. */
  aiStale: boolean;
  /** Finished uploads. An AI flyer requested before one of them must not replace it. */
  uploads: number;
};

type GraphicAction =
  | { type: "ai-ready"; url: string; path: string; uploadsAtRequest: number }
  | { type: "uploaded"; url: string; path: string }
  | { type: "restore-ai" }
  | { type: "details-changed" };

const NO_GRAPHIC: GraphicState = {
  current: null,
  setAsideAi: null,
  aiStale: false,
  uploads: 0,
};

/**
 * Keeps a church's own image from being replaced behind its back.
 *
 * An AI flyer takes a while to draw, and the church can upload its own design
 * in the meantime. Whichever answer arrived last used to win, so a slow flyer
 * could land on top of the upload. Now only the church's own choice replaces
 * its image, and a flyer that finishes late is kept aside instead.
 */
function graphicReducer(state: GraphicState, action: GraphicAction): GraphicState {
  switch (action.type) {
    case "ai-ready": {
      const flyer: Graphic = { url: action.url, path: action.path, source: "ai" };
      if (state.uploads !== action.uploadsAtRequest && state.current?.source === "upload") {
        return { ...state, setAsideAi: flyer };
      }
      return { ...state, current: flyer, setAsideAi: null, aiStale: false };
    }
    case "uploaded":
      return {
        current: { url: action.url, path: action.path, source: "upload" },
        setAsideAi:
          state.current?.source === "ai" && !state.aiStale ? state.current : state.setAsideAi,
        aiStale: false,
        uploads: state.uploads + 1,
      };
    case "restore-ai":
      return state.setAsideAi
        ? { ...state, current: state.setAsideAi, setAsideAi: null, aiStale: false }
        : state;
    case "details-changed":
      // Only a flyer FaithForm drew has the date and time baked into it, so
      // only that one goes stale, along with any flyer set aside. Keeping the
      // church's own design up to date is up to the church.
      return {
        ...state,
        aiStale: state.current?.source === "ai" ? true : state.aiStale,
        setAsideAi: null,
      };
  }
}

async function readUploadError(res: Response): Promise<string> {
  // A body over the platform's limit is refused before the route runs, and
  // that refusal is not JSON.
  if (res.status === 413) return "That image is too large. Try one under 4MB.";
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? "Could not upload that image.";
  } catch {
    return `Could not upload that image (${res.status}).`;
  }
}

/** The viewer's own zone. Read only after a click, so server and browser renders never disagree. */
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

type PostDefaults = { timeZone: string; postTime: string };

type FacebookTimingView = {
  /** The church's zone, which the picker reads and writes in. */
  zone: string;
  /** The church's clock isn't the viewer's, so the picker says which it is. */
  zoneName: string | null;
  mode: FacebookPostMode;
  /** "YYYY-MM-DDTHH:mm" on the church's clock. */
  value: string;
  ms: number | null;
  /** Why the suggestion moved off the day-before slot. Null once the church picks a time. */
  adjusted: FacebookScheduleSuggestion["adjusted"] | null;
  /** The event starts before any time Facebook would take, so "now" was suggested. */
  suggestedNow: boolean;
};

function resolveFacebookTiming(input: {
  startIso: string | null;
  allDay: boolean;
  postDefaults: PostDefaults | null;
  postMode: FacebookPostMode | null;
  postAt: string | null;
}): FacebookTimingView | null {
  if (!input.postDefaults) return null;

  const zone = input.postDefaults.timeZone;
  const suggestion = input.startIso
    ? suggestFacebookSchedule({
        startAt: input.startIso,
        allDay: input.allDay,
        timeZone: zone,
        postTime: input.postDefaults.postTime,
      })
    : null;

  const value =
    input.postAt ?? (suggestion ? toZonedInputValue(suggestion.scheduledAtMs, zone) : "");
  const ms = value ? fromZonedInputValue(value, zone) : null;

  // Compared by name at that moment, not by id: a viewer in America/Louisville
  // and a church in America/New_York share a clock, and a note saying otherwise
  // would only confuse.
  const at = ms ?? Date.now();
  const churchZoneName = describeTimeZone(at, zone);
  const zoneName = churchZoneName === describeTimeZone(at, viewerTimeZone()) ? null : churchZoneName;

  return {
    zone,
    zoneName,
    mode: input.postMode ?? suggestion?.mode ?? "schedule",
    value,
    ms,
    adjusted: input.postAt === null ? (suggestion?.adjusted ?? null) : null,
    suggestedNow: input.postMode === null && suggestion?.mode === "now",
  };
}

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
  // The calendar event's description is the announcement's details: what the
  // phone apps show under Details and what the email carries. It used to start
  // blank, so a description typed when creating the event never reached them.
  const [notes, setNotes] = useState(() => event.description?.trim() ?? "");
  const [showNotes, setShowNotes] = useState(() => Boolean(event.description?.trim()));

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
  const [pushToFacebook, setPushToFacebook] = useState(false);
  const [pushToTeam, setPushToTeam] = useState(true);
  // An event that already happened is not on the app's Home feed, so sharing
  // it there is opt-in. The calendar grid shows the tail of last month, and
  // publishing one of those days looked like a publish that went nowhere.
  const [shareInApp, setShareInApp] = useState(
    () => !hasLeftAppFeed({ startAt: event.startAt, endAt: event.endAt, allDay }),
  );
  const [appAudience, setAppAudience] = useState<"followers" | "members">(
    "followers",
  );

  // Google sends it today and Apple will too; the caller says which the church
  // has. Without that, Google is the only way the email goes out.
  const emailAvailable = defaults.emailAvailable ?? defaults.googleConnected;

  const [facebookCaption, setFacebookCaption] = useState("");
  const [graphic, dispatchGraphic] = useReducer(graphicReducer, NO_GRAPHIC);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  /** The caption was written for event details that have since changed. */
  const [captionStale, setCaptionStale] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When the Facebook post goes out. While these are null the form follows
  // the suggestion, which moves with the event. A choice the church makes
  // stays until the event's date changes.
  const [postDefaults, setPostDefaults] = useState<PostDefaults | null>(null);
  const [postMode, setPostMode] = useState<FacebookPostMode | null>(null);
  const [postAt, setPostAt] = useState<string | null>(null);

  const currentGraphic = graphic.current;
  const usingUpload = currentGraphic?.source === "upload";
  const aiStale = currentGraphic?.source === "ai" && graphic.aiStale;

  /**
   * Asks for a caption, and for a flyer too unless `kind` is "caption".
   *
   * `replaceCaption` is false when switching back to an AI image, so a caption
   * the church has already edited is kept.
   */
  const fetchSocialPreview = useCallback(
    async (kind: "full" | "caption" = "full", replaceCaption = true) => {
      const startIso = allDay
        ? fromDateInputValue(startAt)
        : fromDatetimeLocalValue(startAt);
      if (!startIso || !title.trim()) {
        setPreviewError("Add a title and start time to generate a Facebook preview.");
        return;
      }

      const endIso = !allDay && endAt ? fromDatetimeLocalValue(endAt) : null;
      const setLoading = kind === "full" ? setPreviewLoading : setCaptionLoading;
      const uploadsAtRequest = graphic.uploads;

      setLoading(true);
      setPreviewError(null);
      if (kind === "full") setPreviewWarning(null);

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
            skipImage: kind === "caption",
          }),
        });

        const data = (await res.json()) as {
          preview?: SocialPreviewPayload;
          error?: string;
        };

        if (!res.ok || !data.preview) {
          throw new Error(data.error ?? "Could not generate Facebook preview");
        }

        if (replaceCaption) {
          setFacebookCaption(data.preview.facebookCaption);
          setCaptionStale(false);
        }
        if (kind === "full") {
          dispatchGraphic({
            type: "ai-ready",
            url: data.preview.graphicUrl,
            path: data.preview.graphicPath,
            uploadsAtRequest,
          });
          setPreviewWarning(data.preview.warning ?? null);
        }
      } catch (err) {
        setPreviewError(
          err instanceof Error ? err.message : "Could not generate Facebook preview",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      allDay,
      startAt,
      endAt,
      title,
      location,
      notes,
      event.googleEventId,
      publishedAnnouncementId,
      graphic.uploads,
    ],
  );

  const loadPostDefaults = async () => {
    if (postDefaults) return;
    // Without the church's own settings the viewer's clock and 9:00 AM still
    // give a sensible suggestion, and the server checks whatever is sent.
    const fallback = { timeZone: viewerTimeZone(), postTime: DEFAULT_FACEBOOK_POST_TIME };
    try {
      const result = await getFacebookPostDefaults();
      setPostDefaults(
        result.ok ? { timeZone: result.timeZone, postTime: result.postTime } : fallback,
      );
    } catch {
      setPostDefaults(fallback);
    }
  };

  const handleFacebookToggle = (checked: boolean) => {
    setPushToFacebook(checked);
    if (checked && defaults.facebookConnected) {
      void loadPostDefaults();
      if (usingUpload) {
        // The church's own image stays. Only a missing caption gets written.
        if (!facebookCaption.trim()) void fetchSocialPreview("caption");
      } else {
        void fetchSocialPreview();
      }
    }
    if (!checked && !shareInApp) {
      setPreviewError(null);
      setPreviewWarning(null);
    }
  };

  const handleShareInAppToggle = (checked: boolean) => {
    setShareInApp(checked);
    if (checked && !currentGraphic) {
      void fetchSocialPreview();
    }
  };

  const markDetailsChanged = () => {
    dispatchGraphic({ type: "details-changed" });
    if (facebookCaption.trim()) setCaptionStale(true);
  };

  const handleStartChange = (next: string) => {
    setStartAt(next);
    // A post time picked for the old date says nothing about the new one.
    setPostAt(null);
    markDetailsChanged();
  };

  const handleGraphicFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      // A phone photo is often bigger than the 4MB a request can carry.
      body.append("file", await downscaleForUpload(file));

      const res = await fetch("/api/announcements/graphic-upload", {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error(await readUploadError(res));

      const data = (await res.json()) as { graphicUrl?: string; graphicPath?: string };
      if (!data.graphicUrl || !data.graphicPath) {
        throw new Error("Could not upload that image.");
      }

      dispatchGraphic({ type: "uploaded", url: data.graphicUrl, path: data.graphicPath });
      setPreviewError(null);
      // The image is the church's own; FaithForm still writes the caption.
      if (pushToFacebook && !facebookCaption.trim() && !previewLoading && !captionLoading) {
        void fetchSocialPreview("caption");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload that image.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const switchToAiImage = () => {
    setUploadError(null);
    if (graphic.setAsideAi) {
      dispatchGraphic({ type: "restore-ai" });
      return;
    }
    // Nothing kept aside, or it went stale: draw a new flyer. A caption the
    // church edited is kept unless it describes old details.
    void fetchSocialPreview("full", captionStale || !facebookCaption.trim());
  };

  const posterAltText = [title.trim(), location.trim()].filter(Boolean).join(". ");

  const startIso = allDay ? fromDateInputValue(startAt) : fromDatetimeLocalValue(startAt);
  const endIso = !allDay && endAt ? fromDatetimeLocalValue(endAt) : null;

  // Read from the form as it is now, so moving the date forward clears it.
  const alreadyOver = hasLeftAppFeed({ startAt: startIso, endAt: endIso, allDay });

  // Worked out only while the Facebook panel is open, since it reads the clock
  // and the viewer's zone.
  const facebookTiming =
    pushToFacebook && defaults.facebookConnected
      ? resolveFacebookTiming({ startIso, allDay, postDefaults, postMode, postAt })
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!startIso) {
      setError(allDay ? "Event date is required" : "Start time is required");
      return;
    }

    if (pushToFacebook && !facebookCaption.trim()) {
      setError("Generate or enter a Facebook caption before publishing.");
      return;
    }

    if (pushToFacebook && !currentGraphic) {
      setError("Generate or upload a Facebook image before publishing.");
      return;
    }

    // An AI flyer has the date and time baked into the image by the model, so
    // publishing after an edit would post a flyer announcing the old ones.
    if (pushToFacebook && aiStale) {
      setError(
        "The event changed after this graphic was made — regenerate it before publishing.",
      );
      return;
    }

    if (pushToFacebook && !facebookTiming) {
      setError("Still loading your Facebook post time. Try again in a moment.");
      return;
    }

    // Checked against the clock now, not when the form last drew.
    if (facebookTiming?.mode === "schedule") {
      const check = checkFacebookScheduleTime(facebookTiming.ms);
      if (!check.ok) {
        setError(check.error);
        return;
      }
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
    formData.set(
      "mobile_visibility",
      shareInApp ? appAudience : "none",
    );
    if (posterAltText) {
      formData.set("poster_alt_text", posterAltText);
    }
    formData.set("original_title", event.title);
    formData.set("original_location", event.location);
    formData.set("original_start_at", event.startAt);
    formData.set("original_end_at", event.endAt ?? "");
    if (pushToFacebook) {
      formData.set("facebook_caption", facebookCaption.trim());
    }
    if (pushToFacebook && facebookTiming) {
      formData.set("facebook_post_mode", facebookTiming.mode);
      if (facebookTiming.mode === "schedule" && facebookTiming.ms !== null) {
        formData.set("facebook_scheduled_at", new Date(facebookTiming.ms).toISOString());
      }
    }
    // The image is the app poster as well as the Facebook graphic. Persist it
    // whenever we have one, not only when Facebook is on.
    if (currentGraphic) {
      formData.set("social_graphic_path", currentGraphic.path);
      formData.set("social_graphic_url", currentGraphic.url);
    }

    startTransition(async () => {
      const result = await publishAnnouncement(formData);
      if (!result.ok) {
        setError(result.errors.join(" "));
        return;
      }

      const parts: string[] = ["Submitted!"];
      if (shareInApp) {
        parts.push(
          alreadyOver
            ? "On the app's Schedule calendar only — it already happened, so it is not on Home."
            : appAudience === "members"
              ? "In the FaithForm app for members."
              : "In the FaithForm app for everyone who has added your church.",
        );
      }
      // Says exactly what Facebook was asked to do, on the church's clock.
      if (result.facebookScheduledAt) {
        parts.push(
          `Facebook post scheduled for ${describeFacebookPostTime(
            Date.parse(result.facebookScheduledAt),
            facebookTiming?.zone,
          )}.`,
        );
      } else if (result.facebookUrl) {
        parts.push("Posted to Facebook now.");
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
        facebook_scheduled_publish_time: result.facebookScheduledAt ?? null,
        gmail_draft_id: null,
        published_at: new Date().toISOString(),
        last_publish_error:
          result.errors.length > 0 ? result.errors.join(" ") : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
  };

  const graphicControls = (generateLabel: string) => (
    <GraphicControls
      usingUpload={usingUpload}
      generating={previewLoading}
      uploading={uploading}
      generateLabel={generateLabel}
      onUpload={() => fileInputRef.current?.click()}
      onGenerate={() => void fetchSocialPreview()}
      onUseAi={switchToAiImage}
    />
  );

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

      {/* Said up front, so an edit here is not mistaken for an edit to the
          calendar: a link connection cannot write back to iCloud. */}
      {event.readOnly && (
        <p className="text-xs text-muted-foreground">
          This event comes from your iCloud calendar link. Changes here update
          the announcement only; change the event itself in Apple Calendar.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`title-${event.googleEventId}`}>Title</Label>
        <Input
          id={`title-${event.googleEventId}`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markDetailsChanged();
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
            markDetailsChanged();
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
              onChange={(e) => handleStartChange(e.target.value)}
              required
              className="w-full min-w-0 tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              All-day event — no start or end time.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <DateTimeField
              idPrefix={`start-${event.googleEventId}`}
              label="Start"
              value={startAt}
              required
              onChange={handleStartChange}
            />
            <DateTimeField
              idPrefix={`end-${event.googleEventId}`}
              label="End"
              value={endAt}
              onChange={(next) => {
                setEndAt(next);
                markDetailsChanged();
              }}
            />
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
              ? "Posts to your Facebook Page with a caption and an image, made by AI or your own design. You choose when it goes out."
              : "Connect Facebook in Settings"
          }
        />
        <ToggleRow
          id={`team-${event.googleEventId}`}
          label="Include in weekly email?"
          checked={pushToTeam}
          onCheckedChange={setPushToTeam}
          disabled={!emailAvailable}
          hint={
            emailAvailable
              ? "Adds this event to Monday's weekly email with the rest of this week's calendar."
              : "Connect Google or Apple in Settings to include this in the weekly email."
          }
        />
        <ToggleRow
          id={`app-${event.googleEventId}`}
          label="Share in the FaithForm app"
          checked={shareInApp}
          onCheckedChange={handleShareInAppToggle}
          hint={
            alreadyOver
              ? "This event already happened, so the app won't show it on Home or send a notification. It would only appear on the Schedule calendar for its month."
              : "Shows this event on the church's Home feed and Schedule calendar."
          }
          warning={alreadyOver}
        />
      </ul>

      {/* One picker serves both panels; only one of them offers it at a time. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleGraphicFile(file);
        }}
      />

      {shareInApp && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
            In the FaithForm app
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Who can see this</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`app-audience-${event.googleEventId}`}
                value="followers"
                checked={appAudience === "followers"}
                onChange={() => setAppAudience("followers")}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Anyone who has added your church</span>
                <span className="block text-xs text-muted-foreground">
                  Followers and members, including people still joining.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`app-audience-${event.googleEventId}`}
                value="members"
                checked={appAudience === "members"}
                onChange={() => setAppAudience("members")}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Members only</span>
                <span className="block text-xs text-muted-foreground">
                  Only people who have joined your church in the FaithForm app.
                </span>
              </span>
            </label>
          </fieldset>
          {pushToFacebook && defaults.facebookConnected ? (
            // The Facebook panel owns the image while it is open, so its
            // controls are not offered twice.
            <p className="text-xs text-muted-foreground">
              {"The Facebook image below is the app's poster too."}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                A poster makes the calendar worth opening. Make one or upload
                your own, even if you are not posting to Facebook.
              </p>
              {graphicControls(currentGraphic ? "Regenerate" : "Make a poster")}
              {uploadError && (
                <p className="text-sm text-destructive" role="alert">
                  {uploadError}
                </p>
              )}
              {previewError && (
                <p className="text-sm text-destructive" role="alert">
                  {previewError}
                </p>
              )}
              {aiStale && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Event details changed — regenerate for an updated poster.
                </p>
              )}
              {currentGraphic && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentGraphic.url}
                  alt={posterAltText || "Event poster preview"}
                  className="w-full rounded-md border border-border"
                />
              )}
            </>
          )}
        </div>
      )}

      {pushToFacebook && defaults.facebookConnected && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-semibold">Facebook post</p>
            <p className="text-xs text-muted-foreground">
              Check the caption, choose the image, and pick when it goes out.
            </p>
          </div>

          {graphicControls("Regenerate")}

          {uploadError && (
            <p className="text-sm text-destructive" role="alert">
              {uploadError}
            </p>
          )}

          {previewError && (
            <p className="text-sm text-destructive" role="alert">
              {previewError}
            </p>
          )}

          {previewWarning && !usingUpload && (
            <p className="text-xs text-muted-foreground">{previewWarning}</p>
          )}

          {aiStale && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Event details changed — regenerate for an updated graphic and caption.
            </p>
          )}

          {usingUpload && captionStale && facebookCaption.trim() && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Event details changed — check the caption still matches.
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void fetchSocialPreview("caption")}
                disabled={captionLoading || previewLoading}
              >
                {captionLoading ? "Rewriting…" : "Rewrite caption"}
              </Button>
            </div>
          )}

          {previewLoading && !currentGraphic && (
            <div className="aspect-[1200/630] w-full animate-pulse rounded-md bg-muted" />
          )}

          {currentGraphic && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentGraphic.url}
              alt={
                usingUpload
                  ? "Your uploaded image for Facebook"
                  : "Facebook post graphic preview"
              }
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
                previewLoading || captionLoading
                  ? "Generating caption…"
                  : "Your Facebook post caption will appear here."
              }
              rows={6}
              disabled={(previewLoading || captionLoading) && !facebookCaption}
            />
          </div>

          <div className="border-t border-border pt-3">
            {facebookTiming ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Facebook post time</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={`fb-when-${event.googleEventId}`}
                    value="schedule"
                    checked={facebookTiming.mode === "schedule"}
                    onChange={() => setPostMode("schedule")}
                    className="mt-1"
                  />
                  <span className="font-medium">
                    {facebookTiming.ms !== null
                      ? `Schedule for ${describeFacebookPostTime(facebookTiming.ms, facebookTiming.zone)}`
                      : "Schedule for a date and time"}
                  </span>
                </label>
                {facebookTiming.mode === "schedule" && (
                  <FacebookScheduleField
                    idPrefix={`fb-post-${event.googleEventId}`}
                    timing={facebookTiming}
                    edited={postAt !== null}
                    onChange={setPostAt}
                  />
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={`fb-when-${event.googleEventId}`}
                    value="now"
                    checked={facebookTiming.mode === "now"}
                    onChange={() => setPostMode("now")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">Post now</span>
                    <span className="block text-xs text-muted-foreground">
                      {facebookTiming.suggestedNow
                        ? "The event starts before Facebook could schedule it, so it goes live as soon as you submit."
                        : "Goes live on your Page as soon as you submit."}
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : (
              <p className="text-xs text-muted-foreground">
                Finding your Church Profile post time…
              </p>
            )}
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
            markDetailsChanged();
          }}
          placeholder="Details shown in the app, email, and Facebook…"
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

      <Button
        type="submit"
        disabled={
          pending ||
          uploading ||
          (pushToFacebook && (previewLoading || captionLoading))
        }
        className="w-full"
      >
        {pending ? "Submitting…" : "Verify & submit"}
      </Button>
    </form>
  );
}

/**
 * Upload, regenerate, or switch back to an AI image.
 *
 * Designs made in Canva and the like were the reason for the upload option:
 * a church with its own flyer could only post one FaithForm drew.
 */
function GraphicControls({
  usingUpload,
  generating,
  uploading,
  generateLabel,
  onUpload,
  onGenerate,
  onUseAi,
}: {
  usingUpload: boolean;
  generating: boolean;
  uploading: boolean;
  generateLabel: string;
  onUpload: () => void;
  onGenerate: () => void;
  onUseAi: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onUpload}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {uploading
            ? "Uploading…"
            : usingUpload
              ? "Upload a different image"
              : "Upload your own image"}
        </Button>
        {usingUpload ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onUseAi}
            disabled={generating || uploading}
          >
            <Sparkles className={`size-4 ${generating ? "animate-pulse" : ""}`} />
            {generating ? "Generating…" : "Use an AI image instead"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={generating || uploading}
          >
            <RefreshCw className={`size-4 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating…" : generateLabel}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {usingUpload
          ? "Your own image is posted exactly as you designed it. FaithForm won't replace it unless you choose an AI image."
          : "Have a design already? Upload a JPG, PNG, or WebP. It is never cropped."}
      </p>
    </div>
  );
}

/** The date and time picker under "Schedule for …", and why it shows that time. */
function FacebookScheduleField({
  idPrefix,
  timing,
  edited,
  onChange,
}: {
  idPrefix: string;
  timing: FacebookTimingView;
  edited: boolean;
  onChange: (value: string) => void;
}) {
  const check = checkFacebookScheduleTime(timing.ms);
  const hint =
    timing.adjusted === "none"
      ? "The day before the event, at your Church Profile post time."
      : timing.adjusted === "too-soon"
        ? "It's too late to post the day before, so this is the soonest time Facebook can take it."
        : timing.adjusted === "too-far"
          ? "Facebook schedules posts up to 30 days ahead, so this is the latest it allows."
          : null;

  return (
    <div className="flex flex-col gap-1 pl-6">
      <DateTimeField
        idPrefix={idPrefix}
        label="Facebook post"
        hideLabel
        value={timing.value}
        onChange={onChange}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {timing.zoneName && (
        <p className="text-xs text-muted-foreground">
          {`Times are ${timing.zoneName}, your church's time zone.`}
        </p>
      )}
      {edited && !check.ok && (
        <p className="text-xs text-destructive" role="alert">
          {check.error}
        </p>
      )}
    </div>
  );
}

/**
 * One instant, entered as a date and a time rather than one `datetime-local`.
 *
 * A `datetime-local` control has a large intrinsic width it will not go below,
 * and this form renders inside a queue row. Below that width the browser keeps
 * the field's own layout and clips whatever runs past the edge — which is
 * always the right edge, where the calendar picker button lives. Two narrow
 * fields fit the column, and each keeps its own visible picker.
 *
 * The value stays in `datetime-local` format either way, so callers and the
 * ISO conversion around them are unchanged. A date with no time is not a valid
 * instant, so the pair only reports upward once both halves are filled.
 */
function DateTimeField({
  idPrefix,
  label,
  hideLabel = false,
  value,
  required = false,
  onChange,
}: {
  idPrefix: string;
  label: string;
  /** Keeps the label for screen readers only, where a legend already says it. */
  hideLabel?: boolean;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const [date = "", time = ""] = value.split("T");

  const emit = (nextDate: string, nextTime: string) => {
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  };

  return (
    <div className="flex flex-col gap-1">
      {!hideLabel && (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          id={`${idPrefix}-date`}
          type="date"
          aria-label={`${label} date`}
          value={date}
          onChange={(e) => emit(e.target.value, time)}
          required={required}
          className="w-full min-w-0 px-3 tabular-nums"
        />
        <Input
          id={`${idPrefix}-time`}
          type="time"
          aria-label={`${label} time`}
          value={time}
          onChange={(e) => emit(date, e.target.value)}
          required={required}
          className="w-[9.5rem] min-w-0 px-3 tabular-nums"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
  warning = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
  /** Shows the hint as a caution rather than as help text. */
  warning?: boolean;
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
          <p
            className={`mt-0.5 pl-4 text-xs ${
              warning ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
            }`}
          >
            {hint}
          </p>
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
