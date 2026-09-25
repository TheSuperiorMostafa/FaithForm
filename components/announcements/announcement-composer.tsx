"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Bell,
  CalendarPlus,
  Check,
  ExternalLink,
  ImagePlus,
  Loader2,
  Mail,
  Megaphone,
  Share2,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  getFacebookPostDefaults,
  publishAnnouncement,
  publishToMoreChannels,
} from "@/app/dashboard/announcements/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessState } from "@/components/ui/success-state";
import { Textarea } from "@/components/ui/textarea";
import {
  announcementWhen,
  clearComposerDraft,
  describePostOutcome,
  loadComposerDraft,
  saveComposerDraft,
  type PostedItem,
} from "@/lib/announcements/composer";
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
import { publishedChannels } from "@/lib/announcements/published-channels";
import type { TakenDownAnnouncement } from "@/lib/announcements/standalone";
import { hasLeftAppFeed } from "@/lib/faithform/feed-window";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { formatDateTimeRange } from "@/lib/queries/announcements";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import {
  toDateInputValue,
  toDatetimeLocalValue,
} from "@/lib/utils/announcement-placeholders";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ComposerSettings = {
  churchId: string;
  churchTimeZone: string | null;
  isAdmin: boolean;
  facebookConnected: boolean;
  /** Monday's email can be made (Google or iCloud Mail, and not switched off). */
  emailAvailable: boolean;
  calendarConnected: boolean;
  /** A calendar FaithForm can add events to (not a read-only iCloud link). */
  canCreateEvents: boolean;
};

export type ComposerMode =
  /** A brand-new announcement. */
  | { kind: "new" }
  /** Announce an event from the church calendar, prefilled from it. */
  | { kind: "calendar"; event: CalendarEventPreview; announcementId?: string | null }
  /** Change something that is already posted, or share it in more places. */
  | { kind: "change"; item: PostedItem }
  /** Post again something that was taken down. */
  | { kind: "repost"; item: TakenDownAnnouncement };

type Audience = "followers" | "members" | "public";

type Values = {
  title: string;
  details: string;
  /** About something happening on a particular day. */
  dated: boolean;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  audience: Audience;
  appOn: boolean;
  emailOn: boolean;
  facebookOn: boolean;
  addToCalendar: boolean;
  caption: string;
};

/** The calendar event this announcement belongs to, if any. */
type CalendarLink = {
  eventId: string;
  calendarId: string;
  allDay: boolean;
  readOnly: boolean;
  original: { title: string; location: string; startAt: string; endAt: string | null };
};

// ---------------------------------------------------------------------------
// Picture state (kept from the original form: a slow AI picture never lands
// on top of a picture the church uploaded while it was being made)
// ---------------------------------------------------------------------------

type Graphic = { url: string; path: string; source: "ai" | "upload" | "saved" };

type GraphicState = {
  current: Graphic | null;
  setAsideAi: Graphic | null;
  /** The AI picture has old details drawn into it. */
  aiStale: boolean;
  uploads: number;
};

type GraphicAction =
  | { type: "ai-ready"; url: string; path: string; uploadsAtRequest: number }
  | { type: "uploaded"; url: string; path: string }
  | { type: "restore-ai" }
  | { type: "remove" }
  | { type: "details-changed" };

const NO_GRAPHIC: GraphicState = { current: null, setAsideAi: null, aiStale: false, uploads: 0 };

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
    case "remove":
      return { ...state, current: null, aiStale: false };
    case "details-changed":
      return {
        ...state,
        aiStale: state.current?.source === "ai" ? true : state.aiStale,
        setAsideAi: null,
      };
  }
}

function savedGraphic(url: string | null | undefined, path: string | null | undefined): GraphicState {
  return url && path ? { ...NO_GRAPHIC, current: { url, path, source: "saved" } } : NO_GRAPHIC;
}

// ---------------------------------------------------------------------------
// Facebook timing (the church's own clock and post time)
// ---------------------------------------------------------------------------

type PostDefaults = { timeZone: string; postTime: string };

type FacebookTimingView = {
  zone: string;
  zoneName: string | null;
  mode: FacebookPostMode;
  value: string;
  ms: number | null;
  adjusted: FacebookScheduleSuggestion["adjusted"] | null;
};

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function resolveFacebookTiming(input: {
  startIso: string | null;
  allDay: boolean;
  postDefaults: PostDefaults | null;
  postMode: FacebookPostMode | null;
  postAt: string | null;
  /** Not about an event: there is no "day before" to aim for. */
  preferNow: boolean;
}): FacebookTimingView | null {
  if (!input.postDefaults) return null;
  const zone = input.postDefaults.timeZone;
  const suggestion =
    input.startIso && !input.preferNow
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
  const at = ms ?? Date.now();
  const churchZoneName = describeTimeZone(at, zone);
  const zoneName =
    churchZoneName === describeTimeZone(at, viewerTimeZone()) ? null : churchZoneName;

  return {
    zone,
    zoneName,
    mode: input.postMode ?? (input.preferNow ? "now" : (suggestion?.mode ?? "schedule")),
    value,
    ms,
    adjusted: input.postAt === null ? (suggestion?.adjusted ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Starting values for each way in
// ---------------------------------------------------------------------------

function splitWhen(startAt: string, endAt: string | null, allDay: boolean) {
  if (allDay) return { date: toDateInputValue(startAt), startTime: "", endTime: "" };
  const [date = "", startTime = ""] = toDatetimeLocalValue(startAt).split("T");
  const endTime = endAt ? (toDatetimeLocalValue(endAt).split("T")[1] ?? "") : "";
  return { date, startTime, endTime };
}

function initialState(mode: ComposerMode, settings: ComposerSettings) {
  const base: Values = {
    title: "",
    details: "",
    dated: false,
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    audience: "followers",
    appOn: true,
    emailOn: settings.emailAvailable,
    facebookOn: false,
    addToCalendar: settings.canCreateEvents && settings.isAdmin,
    caption: "",
  };

  if (mode.kind === "calendar") {
    const event = mode.event;
    const allDay = Boolean(event.allDay);
    const over = hasLeftAppFeed({ startAt: event.startAt, endAt: event.endAt, allDay });
    const calendar: CalendarLink = {
      eventId: event.googleEventId,
      calendarId: event.calendarId,
      allDay,
      readOnly: Boolean(event.readOnly),
      original: {
        title: event.title,
        location: event.location,
        startAt: event.startAt,
        endAt: event.endAt,
      },
    };
    return {
      values: {
        ...base,
        title: event.title,
        details: event.description?.trim() ?? "",
        dated: true,
        ...splitWhen(event.startAt, event.endAt, allDay),
        location: event.location,
        // Something that already happened is not on Home and is not worth a
        // notification, so the app is opt-in for it.
        appOn: !over,
        addToCalendar: false,
      },
      calendar,
      graphic: NO_GRAPHIC,
      announcementId: mode.announcementId ?? null,
    };
  }

  if (mode.kind === "change") {
    const { announcement: row, undated, calendar } = mode.item;
    const allDay = Boolean(row.all_day);
    const visibility = row.mobile_visibility ?? "none";
    return {
      values: {
        ...base,
        title: row.title,
        details: row.body ?? "",
        dated: !undated,
        ...(undated
          ? { date: "", startTime: "", endTime: "" }
          : splitWhen(row.start_at, row.end_at, allDay)),
        location: row.event_location ?? "",
        audience: visibility === "none" ? "followers" : visibility,
        appOn: visibility !== "none",
        emailOn: row.push_to_team || mode.item.queuedForWeeklyEmail,
        facebookOn: false,
        addToCalendar: false,
        caption: row.facebook_caption ?? "",
      } satisfies Values,
      calendar:
        row.google_event_id && calendar
          ? {
              eventId: row.google_event_id,
              calendarId: row.google_calendar_id ?? "primary",
              allDay,
              readOnly: calendar.readOnly,
              original: {
                title: row.title,
                location: row.event_location ?? "",
                startAt: row.start_at,
                endAt: row.end_at,
              },
            }
          : null,
      graphic: savedGraphic(row.social_graphic_url, row.social_graphic_path),
      announcementId: row.id,
    };
  }

  if (mode.kind === "repost") {
    const item = mode.item;
    return {
      values: {
        ...base,
        title: item.title,
        details: item.body,
        dated: !item.undated,
        ...(item.undated
          ? { date: "", startTime: "", endTime: "" }
          : splitWhen(item.startAt, item.endAt, item.allDay)),
        location: item.location ?? "",
        addToCalendar: false,
      } satisfies Values,
      calendar: null,
      graphic: savedGraphic(item.graphicUrl, item.graphicPath),
      announcementId: item.id,
    };
  }

  // New: pick up where this browser left off, if it did.
  const draft = loadComposerDraft(settings.churchId);
  return {
    values: draft
      ? {
          ...base,
          title: draft.title,
          details: draft.details,
          dated: draft.dated,
          date: draft.date,
          startTime: draft.startTime,
          endTime: draft.endTime,
          location: draft.location,
          audience: draft.audience,
        }
      : base,
    calendar: null,
    graphic: NO_GRAPHIC,
    announcementId: null,
    restoredDraft: Boolean(draft),
  };
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  if (res.status === 413) return "That picture is too large. Try one under 4MB.";
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

type Outcome = {
  title: string;
  lines: string[];
  problems: string[];
  facebookUrl?: string;
};

export function AnnouncementComposer({
  mode,
  settings,
  onClose,
  onPosted,
}: {
  mode: ComposerMode;
  settings: ComposerSettings;
  onClose: () => void;
  onPosted: () => void;
}) {
  // Frozen at open: a page refresh behind the composer must not move it.
  const [initial] = useState(() => initialState(mode, settings));
  const [values, setValues] = useState<Values>(initial.values);
  const [graphic, dispatchGraphic] = useReducer(graphicReducer, initial.graphic);
  const calendar = initial.calendar;
  const [restoredDraft, setRestoredDraft] = useState(
    "restoredDraft" in initial ? Boolean(initial.restoredDraft) : false,
  );

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorNeedsSettings, setErrorNeedsSettings] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** A calendar event this composer already made, reused if posting is retried. */
  const [createdEvent, setCreatedEvent] = useState<CalendarEventPreview | null>(null);

  const [pictureLoading, setPictureLoading] = useState(false);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [postDefaults, setPostDefaults] = useState<PostDefaults | null>(null);
  const [postMode, setPostMode] = useState<FacebookPostMode | null>(null);
  const [postAt, setPostAt] = useState<string | null>(null);

  const changing = mode.kind === "change";
  const already = mode.kind === "change"
    ? publishedChannels(mode.item.announcement, {
        queuedForWeeklyEmail: mode.item.queuedForWeeklyEmail,
      })
    : null;

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  // Changing what the picture shows makes an AI picture out of date.
  const setDetail = <K extends "title" | "details" | "date" | "startTime" | "endTime" | "location">(
    key: K,
    value: Values[K],
  ) => {
    set(key, value);
    dispatchGraphic({ type: "details-changed" });
    if (key === "date" || key === "startTime") setPostAt(null);
  };

  // ---- derived -------------------------------------------------------------

  const dated = calendar ? true : values.dated;
  const when = announcementWhen({
    dated,
    date: values.date,
    startTime: calendar?.allDay ? "" : values.startTime,
    endTime: calendar?.allDay ? "" : values.endTime,
    timeZone: settings.churchTimeZone,
  });
  const whenOk = "startAt" in when ? when : null;
  const undated = !dated;
  const alreadyOver = whenOk ? hasLeftAppFeed(whenOk) : false;
  const hasTime = Boolean(values.startTime.trim()) && dated && !calendar?.allDay;

  const facebookOnPage = Boolean(already?.facebook.published);
  const facebookNew = values.facebookOn && settings.facebookConnected && !facebookOnPage;
  const appAlready = Boolean(already?.app.published);
  const emailAlready = Boolean(already?.weeklyEmail.published);
  const willAddToCalendar =
    !calendar &&
    !createdEvent &&
    mode.kind === "new" &&
    values.addToCalendar &&
    hasTime &&
    settings.canCreateEvents &&
    settings.isAdmin;

  const facebookTiming = facebookNew
    ? resolveFacebookTiming({
        startIso: whenOk?.startAt ?? null,
        allDay: whenOk?.allDay ?? true,
        postDefaults,
        postMode,
        postAt,
        preferNow: undated,
      })
    : null;

  const currentGraphic = graphic.current;
  const usingOwnPicture =
    currentGraphic?.source === "upload" || currentGraphic?.source === "saved";
  const aiStale = currentGraphic?.source === "ai" && graphic.aiStale;
  const posterAltText = [values.title.trim(), values.location.trim()].filter(Boolean).join(". ");

  // What changed, for "Change": the details, or only where it goes.
  const originalSnapshot = useMemo(() => JSON.stringify(initial.values), [initial.values]);
  const initialGraphicPath = initial.graphic.current?.path ?? null;
  const detailsChanged = useMemo(() => {
    const before = initial.values;
    return (
      before.title.trim() !== values.title.trim() ||
      before.details.trim() !== values.details.trim() ||
      before.location.trim() !== values.location.trim() ||
      before.dated !== values.dated ||
      before.date !== values.date ||
      before.startTime !== values.startTime ||
      before.endTime !== values.endTime ||
      (currentGraphic?.path ?? null) !== initialGraphicPath
    );
  }, [initial.values, values, currentGraphic, initialGraphicPath]);
  // A new announcement with anything in it counts as work, even one restored
  // from this browser: closing asks before throwing it away.
  const dirty =
    !outcome &&
    (mode.kind === "new"
      ? Boolean(values.title.trim() || values.details.trim() || currentGraphic)
      : JSON.stringify(values) !== originalSnapshot ||
        (currentGraphic?.path ?? null) !== initialGraphicPath);

  // ---- keep unsent work ----------------------------------------------------

  useEffect(() => {
    if (mode.kind !== "new" || outcome) return;
    const timer = window.setTimeout(() => {
      if (!values.title.trim() && !values.details.trim()) {
        clearComposerDraft(settings.churchId);
        return;
      }
      saveComposerDraft(settings.churchId, {
        title: values.title,
        details: values.details,
        dated: values.dated,
        date: values.date,
        startTime: values.startTime,
        endTime: values.endTime,
        location: values.location,
        audience: values.audience === "members" ? "members" : "followers",
        savedAt: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [mode.kind, outcome, values, settings.churchId]);

  const requestClose = useCallback(async () => {
    if (pending) return;
    if (dirty) {
      const discard = await confirmAction({
        title: "Discard this announcement?",
        description: "What you've written so far will be lost.",
        confirmLabel: "Discard announcement",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!discard) return;
      if (mode.kind === "new") clearComposerDraft(settings.churchId);
    }
    onClose();
  }, [pending, dirty, mode.kind, settings.churchId, onClose]);

  const startOver = () => {
    clearComposerDraft(settings.churchId);
    setValues({ ...initial.values, title: "", details: "", dated: false, date: "", startTime: "", endTime: "", location: "", audience: "followers" });
    setRestoredDraft(false);
  };

  // ---- pictures and captions ------------------------------------------------

  const askForPicture = async (kind: "full" | "caption", replaceCaption = true) => {
      if (!values.title.trim()) {
        setPictureError("Add a title first, so the picture has something to say.");
        return;
      }
      if (!whenOk) {
        setPictureError("Choose the day first.");
        return;
      }
      const setLoading = kind === "full" ? setPictureLoading : setCaptionLoading;
      const uploadsAtRequest = graphic.uploads;
      setLoading(true);
      setPictureError(null);
      if (kind === "full") setPictureNote(null);
      try {
        const res = await fetch("/api/announcements/social-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: values.title.trim(),
            location: dated ? values.location.trim() : "",
            startAt: whenOk.startAt,
            endAt: whenOk.endAt,
            allDay: whenOk.allDay,
            notes: values.details.trim() || undefined,
            googleEventId: calendar?.eventId ?? null,
            announcementId: initial.announcementId ?? undefined,
            skipImage: kind === "caption",
          }),
        });
        if (!res.ok) {
          throw new Error(await readJsonError(res, "We couldn't make that right now. Please try again."));
        }
        const data = (await res.json()) as {
          preview?: { facebookCaption: string; graphicUrl: string; graphicPath: string; warning?: string };
        };
        if (!data.preview) throw new Error("We couldn't make that right now. Please try again.");
        if (replaceCaption) set("caption", data.preview.facebookCaption);
        if (kind === "full") {
          dispatchGraphic({
            type: "ai-ready",
            url: data.preview.graphicUrl,
            path: data.preview.graphicPath,
            uploadsAtRequest,
          });
          // The route's own note is written for engineers.
          if (data.preview.warning) {
            setPictureNote("Designed pictures aren't available right now, so we used a photo instead.");
          }
        }
      } catch (err) {
        setPictureError(
          err instanceof Error && !(err instanceof TypeError || err instanceof SyntaxError) && err.message
            ? err.message
            : "We couldn't make that right now. Please try again.",
        );
      } finally {
        setLoading(false);
      }
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    setPictureError(null);
    try {
      const body = new FormData();
      body.append("file", await downscaleForUpload(file));
      const res = await fetch("/api/announcements/graphic-upload", { method: "POST", body });
      if (!res.ok) throw new Error(await readJsonError(res, "That picture could not be uploaded."));
      const data = (await res.json()) as { graphicUrl?: string; graphicPath?: string };
      if (!data.graphicUrl || !data.graphicPath) {
        throw new Error("That picture could not be uploaded.");
      }
      dispatchGraphic({ type: "uploaded", url: data.graphicUrl, path: data.graphicPath });
      setPictureNote(null);
    } catch (err) {
      setPictureError(
        err instanceof Error && !(err instanceof TypeError || err instanceof SyntaxError) && err.message ? err.message : "That picture could not be uploaded.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const loadPostDefaults = async () => {
    if (postDefaults) return;
    const fallback = { timeZone: settings.churchTimeZone ?? viewerTimeZone(), postTime: DEFAULT_FACEBOOK_POST_TIME };
    try {
      const result = await getFacebookPostDefaults();
      setPostDefaults(result.ok ? { timeZone: result.timeZone, postTime: result.postTime } : fallback);
    } catch {
      setPostDefaults(fallback);
    }
  };

  const toggleFacebook = (checked: boolean) => {
    set("facebookOn", checked);
    // Only the post time is looked up. Nothing is written or drawn until the
    // church asks for it.
    if (checked) void loadPostDefaults();
  };

  // ---- posting --------------------------------------------------------------

  const validate = (): string | null => {
    if (!values.title.trim()) return "Give the announcement a title.";
    if ("error" in when) return when.error;
    if (calendar && !calendar.allDay && !values.startTime.trim()) {
      return "Choose a start time for this event.";
    }
    const emailOn = values.emailOn && settings.emailAvailable;
    if (!values.appOn && !emailOn && !facebookNew && !changing && !willAddToCalendar) {
      return "Choose at least one place to share it.";
    }
    if (facebookNew && aiStale) {
      return "The picture still shows the old details. Make a new picture, or upload your own, before posting.";
    }
    if (facebookNew && !facebookTiming) {
      return "Still finding your Facebook post time. Try again in a moment.";
    }
    if (facebookTiming?.mode === "schedule") {
      const check = checkFacebookScheduleTime(facebookTiming.ms);
      if (!check.ok) return check.error;
    }
    return null;
  };

  const appendFacebook = (form: FormData) => {
    if (!facebookNew) return;
    form.set("facebook_caption", values.caption.trim());
    if (facebookTiming) {
      form.set("facebook_post_mode", facebookTiming.mode);
      if (facebookTiming.mode === "schedule" && facebookTiming.ms !== null) {
        form.set("facebook_scheduled_at", new Date(facebookTiming.ms).toISOString());
      }
    }
  };

  const appendPicture = (form: FormData) => {
    if (currentGraphic) {
      form.set("social_graphic_path", currentGraphic.path);
      form.set("social_graphic_url", currentGraphic.url);
    }
    if (posterAltText) form.set("poster_alt_text", posterAltText);
  };

  const createCalendarEvent = async (): Promise<CalendarEventPreview | null> => {
    if (!whenOk) return null;
    const res = await fetch("/api/announcements/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: values.title.trim(),
        location: values.location.trim() || undefined,
        startAt: whenOk.startAt,
        endAt: whenOk.endAt,
        description: values.details.trim() || undefined,
      }),
    });
    if (!res.ok) {
      let message = "We couldn't add it to your church calendar. Nothing was posted.";
      let reconnect = false;
      try {
        const data = (await res.json()) as { error?: string; reconnect?: boolean };
        if (data.error) message = `${data.error.replace(/[.!?]$/, "")}. Nothing was posted.`;
        reconnect = Boolean(data.reconnect);
      } catch {
        // Keep the plain message.
      }
      setErrorNeedsSettings(reconnect);
      setError(`${message} You can untick "Also add it to your church calendar" to post without it.`);
      return null;
    }
    const data = (await res.json()) as { event: CalendarEventPreview };
    setCreatedEvent(data.event);
    return data.event;
  };

  const submit = () => {
    setError(null);
    setErrorNeedsSettings(false);
    const problem = validate();
    if (problem || !whenOk) {
      setError(problem ?? "Check the date and time.");
      return;
    }

    startTransition(async () => {
      try {
        // "Change" with the same details only shares it in new places, so the
        // app is not changed and no one is notified again.
        if (mode.kind === "change" && !detailsChanged) {
          const addApp = values.appOn && !appAlready;
          const addEmail = values.emailOn && !emailAlready;
          if (!addApp && !addEmail && !facebookNew) {
            setError("Nothing has changed yet. Change the details, or tick a new place to share it.");
            return;
          }
          const form = new FormData();
          form.set("announcement_id", mode.item.announcement.id);
          form.set("push_to_facebook", facebookNew ? "true" : "false");
          form.set("push_to_team", addEmail ? "true" : "false");
          form.set("mobile_visibility", addApp ? values.audience : "none");
          appendFacebook(form);
          appendPicture(form);
          const result = await publishToMoreChannels(form);
          if (!result.ok) {
            setError(result.errors[0] ?? "We couldn't share it there. Please try again.");
            return;
          }
          finish({
            title: "Announcement updated",
            lines: describePostOutcome({
              inApp: addApp && (result.announcement?.mobile_visibility ?? "none") !== "none",
              notified: Boolean(result.notified),
              audience: values.audience,
              alreadyOver,
              queuedForWeeklyEmail: addEmail && result.queuedForWeeklyEmail,
              facebookUrl: result.facebookUrl,
              facebookScheduledAt: result.facebookScheduledAt,
              timeZone: facebookTiming?.zone ?? settings.churchTimeZone,
            }),
            problems: result.errors,
            facebookUrl: result.facebookScheduledAt ? undefined : result.facebookUrl,
          });
          return;
        }

        let event: CalendarEventPreview | null = createdEvent;
        if (willAddToCalendar) {
          event = await createCalendarEvent();
          if (!event) return;
        }

        const link = calendar
          ? { eventId: calendar.eventId, calendarId: calendar.calendarId }
          : event
            ? { eventId: event.googleEventId, calendarId: event.calendarId }
            : null;

        const form = new FormData();
        form.set("church_id", settings.churchId);
        form.set("title", values.title.trim());
        form.set("location", dated ? values.location.trim() : "");
        form.set("start_at", whenOk.startAt);
        if (whenOk.endAt) form.set("end_at", whenOk.endAt);
        form.set("all_day", whenOk.allDay ? "true" : "false");
        form.set("notes", values.details.trim());
        if (link) {
          form.set("google_event_id", link.eventId);
          form.set("google_calendar_id", link.calendarId);
        } else if (undated) {
          form.set("undated", "true");
        }
        if (initial.announcementId) form.set("announcement_id", initial.announcementId);
        form.set("push_to_facebook", facebookNew ? "true" : "false");
        if (facebookOnPage) {
          form.set("already_on_facebook", "true");
          form.set("facebook_caption", values.caption.trim());
        }
        form.set(
          "push_to_team",
          (values.emailOn && settings.emailAvailable) || emailAlready ? "true" : "false",
        );
        form.set("mobile_visibility", values.appOn ? values.audience : "none");
        if (calendar) {
          form.set("original_title", calendar.original.title);
          form.set("original_location", calendar.original.location);
          form.set("original_start_at", calendar.original.startAt);
          form.set("original_end_at", calendar.original.endAt ?? "");
        } else if (event) {
          // Just made from these details: nothing to write back.
          form.set("original_title", event.title);
          form.set("original_location", event.location);
          form.set("original_start_at", event.startAt);
          form.set("original_end_at", event.endAt ?? "");
        }
        appendFacebook(form);
        appendPicture(form);

        const result = await publishAnnouncement(form);
        if (!result.ok) {
          setError(result.errors[0] ?? "We couldn't post this announcement. Please try again.");
          return;
        }
        finish({
          title: changing ? "Announcement updated" : "Announcement posted",
          lines: describePostOutcome({
            inApp: Boolean(result.inApp),
            notified: Boolean(result.notified),
            audience: values.audience,
            alreadyOver,
            queuedForWeeklyEmail: result.queuedForWeeklyEmail,
            facebookUrl: result.facebookUrl,
            facebookScheduledAt: result.facebookScheduledAt,
            timeZone: facebookTiming?.zone ?? settings.churchTimeZone,
            calendarAdded: Boolean(event && !calendar),
            updated: changing,
          }),
          problems: result.errors,
          facebookUrl: result.facebookScheduledAt ? undefined : result.facebookUrl,
        });
      } catch {
        setError("We couldn't reach FaithForm. Nothing was lost. Check your connection and try again.");
      }
    });
  };

  const finish = (next: Outcome) => {
    if (mode.kind === "new") clearComposerDraft(settings.churchId);
    setOutcome(next);
    onPosted();
  };

  // ---- view -------------------------------------------------------------------

  const heading =
    mode.kind === "change"
      ? "Change announcement"
      : mode.kind === "calendar"
        ? "Announce this event"
        : mode.kind === "repost"
          ? "Post it again"
          : "New announcement";

  const submitLabel = changing ? "Update announcement" : "Post announcement";
  const busy = pending || uploading || pictureLoading || captionLoading;

  const whatHappens: string[] = [];
  if (values.appOn || appAlready) {
    if (alreadyOver) {
      whatHappens.push("Shows on the FaithForm app's calendar. It already happened, so no one gets a notification.");
    } else if (appAlready && !detailsChanged) {
      whatHappens.push("Stays in the FaithForm app as it is.");
    } else {
      whatHappens.push(appAlready ? "Updates it in the FaithForm app now." : "Posts to the FaithForm app now.");
      whatHappens.push(
        values.audience === "members"
          ? "Members get a notification."
          : "Everyone who follows your church gets a notification.",
      );
    }
  }
  if ((values.emailOn && settings.emailAvailable) || emailAlready) whatHappens.push("It's in Monday's email.");
  if (facebookOnPage) whatHappens.push("It's already on Facebook.");
  else if (facebookNew) {
    whatHappens.push(
      facebookTiming?.mode === "schedule" && facebookTiming.ms !== null
        ? `Goes on Facebook ${describeFacebookPostTime(facebookTiming.ms, facebookTiming.zone)}.`
        : "Goes on Facebook as soon as you post.",
    );
  }
  if (willAddToCalendar) whatHappens.push("Added to your church calendar.");
  if (whatHappens.length === 0) whatHappens.push("Not shared anywhere yet. Tick a place above.");

  const previewWhen = !whenOk
    ? null
    : undated
      ? "Today"
      : formatDateTimeRange(whenOk.startAt, whenOk.endAt, null, whenOk.allDay).replace(" – ongoing", "");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100%-2rem)] max-w-5xl"
        aria-labelledby="announcement-composer-title"
        // Outside click, Escape and the X all come here. The composer decides
        // itself, asking first when there is work to lose.
        onRequestClose={() => {
          void requestClose();
          return false;
        }}
      >
        <DialogHeader className="pr-14">
          <DialogTitle id="announcement-composer-title">{outcome ? outcome.title : heading}</DialogTitle>
          {!outcome && (
            <DialogDescription className="text-base">
              Say what&apos;s happening, choose who sees it, and where it goes.
            </DialogDescription>
          )}
        </DialogHeader>

        {outcome ? (
          <div className="overflow-y-auto px-6 py-6">
            <SuccessState
              title={outcome.title}
              description={
                outcome.lines.length > 0 ? (
                  <span className="flex flex-col gap-1">
                    {outcome.lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                ) : (
                  "It's saved."
                )
              }
              actions={
                <>
                  <Button onClick={onClose}>Done</Button>
                  {outcome.facebookUrl && (
                    <a
                      href={outcome.facebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex"
                    >
                      <Button variant="outline" type="button">
                        <ExternalLink aria-hidden />
                        View on Facebook
                      </Button>
                    </a>
                  )}
                </>
              }
            >
              {outcome.problems.length > 0 && (
                <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="font-semibold">Something needs a look</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {outcome.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </SuccessState>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="flex min-w-0 flex-col gap-8">
                  {restoredDraft && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-[15px]">
                      <span>We kept the announcement you were writing.</span>
                      <Button type="button" variant="ghost" onClick={startOver}>
                        Start over
                      </Button>
                    </div>
                  )}

                  {/* What? */}
                  <Section title="What do you want to say?">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="composer-title" className="text-[15px]">
                        Title
                      </Label>
                      <Input
                        id="composer-title"
                        value={values.title}
                        onChange={(e) => setDetail("title", e.target.value)}
                        placeholder="e.g. Fall potluck this Sunday"
                        autoFocus={mode.kind === "new"}
                        className="text-base"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="composer-details" className="text-[15px]">
                        Message <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Textarea
                        id="composer-details"
                        value={values.details}
                        onChange={(e) => setDetail("details", e.target.value)}
                        placeholder="The details people need to know."
                        rows={4}
                        className="text-base"
                      />
                    </div>

                    <PictureField
                      graphic={currentGraphic}
                      canRestoreAi={Boolean(graphic.setAsideAi) && usingOwnPicture}
                      aiStale={aiStale}
                      loading={pictureLoading}
                      uploading={uploading}
                      error={pictureError}
                      note={pictureNote}
                      alt={posterAltText || "Announcement picture"}
                      onMake={() => void askForPicture("full", !values.caption.trim())}
                      onUpload={() => fileInputRef.current?.click()}
                      onRestoreAi={() => dispatchGraphic({ type: "restore-ai" })}
                      onRemove={() => dispatchGraphic({ type: "remove" })}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                      }}
                    />
                  </Section>

                  {/* When? */}
                  <Section title="When is it?">
                    {calendar?.readOnly && (
                      <p className="text-[15px] text-muted-foreground">
                        This event comes from your iCloud calendar link. Changes here update the
                        announcement only. Change the event itself in Apple Calendar.
                      </p>
                    )}
                    {!calendar && (
                      <div className="choice-grid" role="radiogroup" aria-label="When is it?">
                        <ChoiceCard
                          name="composer-dated"
                          checked={!values.dated}
                          onSelect={() => set("dated", false)}
                          title="It's not an event"
                          hint="Like “Office closed” or “Pray for the Smiths”."
                        />
                        <ChoiceCard
                          name="composer-dated"
                          checked={values.dated}
                          onSelect={() => set("dated", true)}
                          title="It's on a certain day"
                          hint="An event, a service or a deadline."
                        />
                      </div>
                    )}
                    {dated && (
                      <div className="flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="flex min-w-0 flex-col gap-2">
                            <Label htmlFor="composer-date" className="text-[15px]">
                              Day
                            </Label>
                            <Input
                              id="composer-date"
                              type="date"
                              value={values.date}
                              onChange={(e) => setDetail("date", e.target.value)}
                              className="min-w-0 tabular-nums"
                            />
                          </div>
                          {!calendar?.allDay && (
                            <>
                              <div className="flex min-w-0 flex-col gap-2">
                                <Label htmlFor="composer-start" className="text-[15px]">
                                  Starts{" "}
                                  {!calendar && (
                                    <span className="font-normal text-muted-foreground">(optional)</span>
                                  )}
                                </Label>
                                <Input
                                  id="composer-start"
                                  type="time"
                                  value={values.startTime}
                                  onChange={(e) => setDetail("startTime", e.target.value)}
                                  className="min-w-0 tabular-nums"
                                />
                              </div>
                              <div className="flex min-w-0 flex-col gap-2">
                                <Label htmlFor="composer-end" className="text-[15px]">
                                  Ends <span className="font-normal text-muted-foreground">(optional)</span>
                                </Label>
                                <Input
                                  id="composer-end"
                                  type="time"
                                  value={values.endTime}
                                  onChange={(e) => setDetail("endTime", e.target.value)}
                                  disabled={!values.startTime}
                                  className="min-w-0 tabular-nums"
                                />
                              </div>
                            </>
                          )}
                        </div>
                        {calendar?.allDay && (
                          <p className="text-[15px] text-muted-foreground">An all-day event on your calendar.</p>
                        )}
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="composer-location" className="text-[15px]">
                            Where <span className="font-normal text-muted-foreground">(optional)</span>
                          </Label>
                          <Input
                            id="composer-location"
                            value={values.location}
                            onChange={(e) => setDetail("location", e.target.value)}
                            placeholder="e.g. Fellowship Hall"
                          />
                        </div>
                        {mode.kind === "new" && settings.canCreateEvents && settings.isAdmin && (
                          <CheckRow
                            id="composer-calendar"
                            icon={<CalendarPlus className="size-5" strokeWidth={1.75} aria-hidden />}
                            label="Also add it to your church calendar"
                            checked={values.addToCalendar && hasTime}
                            disabled={!hasTime}
                            onChange={(checked) => set("addToCalendar", checked)}
                            hint={
                              hasTime
                                ? "It shows up with your other events, ready for check-in."
                                : "Add a start time to also put it on your calendar."
                            }
                          />
                        )}
                      </div>
                    )}
                  </Section>

                  {/* Who? */}
                  <Section title="Who sees it in the app?">
                    {appAlready ? (
                      <p className="text-[15px] text-muted-foreground">
                        {values.audience === "members"
                          ? "Members only."
                          : "Everyone who follows your church."}{" "}
                        To change who sees it, take it down and post it again.
                      </p>
                    ) : (
                      <div className="choice-grid" role="radiogroup" aria-label="Who sees it">
                        <ChoiceCard
                          name="composer-audience"
                          checked={values.audience !== "members"}
                          onSelect={() => set("audience", "followers")}
                          title="Everyone who follows your church"
                          hint="Members and people who added your church in the app."
                        />
                        <ChoiceCard
                          name="composer-audience"
                          checked={values.audience === "members"}
                          onSelect={() => set("audience", "members")}
                          title="Members only"
                          hint="Only people who joined your church in the app."
                        />
                      </div>
                    )}
                  </Section>

                  {/* Where? */}
                  <Section title="Where should it go?">
                    <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
                      <CheckRow
                        as="li"
                        id="composer-app"
                        icon={<Smartphone className="size-5" strokeWidth={1.75} aria-hidden />}
                        label="The FaithForm app"
                        checked={values.appOn || appAlready}
                        disabled={appAlready}
                        onChange={(checked) => set("appOn", checked)}
                        hint={
                          appAlready
                            ? "Already in the app."
                            : alreadyOver
                              ? "This already happened, so it only shows on the app's calendar and no one gets a notification."
                              : values.appOn
                                ? values.audience === "members"
                                  ? "Posts to the app now. Members get a notification."
                                  : "Posts to the app now. Everyone who follows your church gets a notification."
                                : "Leave this on so people see it in the app."
                        }
                        hintTone={alreadyOver && values.appOn ? "warning" : "muted"}
                      />
                      <CheckRow
                        as="li"
                        id="composer-email"
                        icon={<Mail className="size-5" strokeWidth={1.75} aria-hidden />}
                        label="Monday's weekly email"
                        checked={(values.emailOn && settings.emailAvailable) || emailAlready}
                        disabled={emailAlready || !settings.emailAvailable}
                        onChange={(checked) => set("emailOn", checked)}
                        hint={
                          emailAlready
                            ? "Already in Monday's email."
                            : settings.emailAvailable
                              ? "Added to the email of this week's announcements."
                              : "Connect Google or iCloud in Settings to send a weekly email."
                        }
                      />
                      <CheckRow
                        as="li"
                        id="composer-facebook"
                        icon={<Share2 className="size-5" strokeWidth={1.75} aria-hidden />}
                        label="Also post on Facebook"
                        checked={facebookOnPage || (values.facebookOn && settings.facebookConnected)}
                        disabled={facebookOnPage || !settings.facebookConnected}
                        onChange={toggleFacebook}
                        hint={
                          facebookOnPage
                            ? "Already on your Facebook Page."
                            : settings.facebookConnected
                              ? "Posts to your church's Facebook Page with a picture."
                              : "Connect Facebook in Settings to post there too."
                        }
                        trailing={
                          facebookOnPage && already?.facebook.published ? (
                            <a
                              href={already.facebook.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                            >
                              View post
                              <ExternalLink className="size-4" aria-hidden />
                            </a>
                          ) : undefined
                        }
                      />
                    </ul>

                    {facebookNew && (
                      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-end justify-between gap-2">
                            <Label htmlFor="composer-caption" className="text-[15px]">
                              Facebook caption <span className="font-normal text-muted-foreground">(optional)</span>
                            </Label>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void askForPicture("caption")}
                              disabled={captionLoading || pictureLoading}
                            >
                              {captionLoading ? (
                                <Loader2 className="animate-spin" aria-hidden />
                              ) : (
                                <Sparkles aria-hidden />
                              )}
                              {captionLoading ? "Writing…" : "Write a caption for me"}
                            </Button>
                          </div>
                          <Textarea
                            id="composer-caption"
                            value={values.caption}
                            onChange={(e) => set("caption", e.target.value)}
                            placeholder="Leave empty and we'll use your title and message."
                            rows={5}
                            className="text-base"
                          />
                        </div>
                        <p className="text-[15px] text-muted-foreground">
                          {currentGraphic
                            ? "Facebook uses the picture above."
                            : "Facebook posts need a picture. Add one above, or we'll make a simple one from your title."}
                        </p>

                        {facebookTiming ? (
                          <fieldset className="flex flex-col gap-3">
                            <legend className="mb-2 text-[15px] font-semibold">When should it go on Facebook?</legend>
                            <RadioRow
                              name="composer-fb-when"
                              checked={facebookTiming.mode === "now"}
                              onSelect={() => setPostMode("now")}
                              label="As soon as I post"
                            />
                            <RadioRow
                              name="composer-fb-when"
                              checked={facebookTiming.mode === "schedule"}
                              onSelect={() => setPostMode("schedule")}
                              label={
                                facebookTiming.ms !== null
                                  ? `Schedule for ${describeFacebookPostTime(facebookTiming.ms, facebookTiming.zone)}`
                                  : "Schedule for a day and time"
                              }
                            />
                            {facebookTiming.mode === "schedule" && (
                              <FacebookScheduleField
                                timing={facebookTiming}
                                edited={postAt !== null}
                                onChange={setPostAt}
                              />
                            )}
                          </fieldset>
                        ) : (
                          <p className="text-[15px] text-muted-foreground">Finding your usual Facebook post time…</p>
                        )}
                      </div>
                    )}
                  </Section>
                </div>

                {/* Preview */}
                <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start" aria-label="Preview">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
                  <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    {currentGraphic ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentGraphic.url}
                        alt={posterAltText || "Announcement picture"}
                        className="aspect-[1200/630] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[1200/630] w-full items-center justify-center bg-primary/[0.06] text-primary dark:bg-accent/10 dark:text-accent">
                        <Megaphone className="size-8" strokeWidth={1.5} aria-hidden />
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5 p-4">
                      <p className="text-base font-semibold leading-snug text-foreground">
                        {values.title.trim() || "Your title"}
                      </p>
                      {previewWhen && <p className="text-sm text-muted-foreground">{previewWhen}</p>}
                      {dated && values.location.trim() && (
                        <p className="text-sm text-muted-foreground">{values.location.trim()}</p>
                      )}
                      {values.details.trim() && (
                        <p className="line-clamp-4 whitespace-pre-wrap text-[15px] text-foreground/85">
                          {values.details.trim()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/30 p-4">
                    <p className="text-[15px] font-semibold">When you post</p>
                    <ul className="mt-2 flex flex-col gap-2 text-[15px] text-foreground/85">
                      {whatHappens.map((line) => (
                        <li key={line} className="flex gap-2">
                          {line.includes("notification") ? (
                            <Bell className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                          ) : (
                            <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                          )}
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </aside>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-6 py-4">
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[15px] text-destructive"
                >
                  {error}
                  {errorNeedsSettings && (
                    <>
                      {" "}
                      <Link
                        href="/dashboard/settings?tab=accounts"
                        className="font-semibold underline underline-offset-2"
                      >
                        Open Settings
                      </Link>
                    </>
                  )}
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={pending}>
                  Cancel
                </Button>
                <Button type="button" size="lg" onClick={submit} disabled={busy}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Megaphone aria-hidden />}
                  {pending ? (changing ? "Updating…" : "Posting…") : submitLabel}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="font-heading text-lg font-bold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ChoiceCard({
  name,
  checked,
  onSelect,
  title,
  hint,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[72px] cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors",
        checked
          ? "border-accent bg-accent/10 ring-1 ring-accent/40"
          : "border-border hover:bg-accent/[0.05]",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function RadioRow({
  name,
  checked,
  onSelect,
  label,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="size-5 shrink-0 accent-[var(--accent)]"
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}

function CheckRow({
  as: Tag = "div",
  id,
  icon,
  label,
  checked,
  disabled = false,
  onChange,
  hint,
  hintTone = "muted",
  trailing,
}: {
  as?: "div" | "li";
  id: string;
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  hintTone?: "muted" | "warning";
  trailing?: ReactNode;
}) {
  return (
    <Tag className="flex items-center gap-3 px-4 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 accent-[var(--accent)] disabled:opacity-60"
      />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent">
        {icon}
      </span>
      <label htmlFor={id} className={cn("min-w-0 flex-1", !disabled && "cursor-pointer")}>
        <span className="block text-[15px] font-semibold text-foreground">{label}</span>
        {hint && (
          <span
            className={cn(
              "mt-0.5 block text-sm",
              hintTone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        )}
      </label>
      {trailing}
    </Tag>
  );
}

function PictureField({
  graphic,
  canRestoreAi,
  aiStale,
  loading,
  uploading,
  error,
  note,
  alt,
  onMake,
  onUpload,
  onRestoreAi,
  onRemove,
}: {
  graphic: Graphic | null;
  canRestoreAi: boolean;
  aiStale: boolean;
  loading: boolean;
  uploading: boolean;
  error: string | null;
  note: string | null;
  alt: string;
  onMake: () => void;
  onUpload: () => void;
  onRestoreAi: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-semibold text-foreground">
        Picture <span className="font-normal text-muted-foreground">(optional)</span>
      </p>
      {loading && !graphic && (
        <div className="flex aspect-[1200/630] w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-muted text-[15px] text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Making your picture…
        </div>
      )}
      {graphic && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={graphic.url} alt={alt} className="w-full max-w-md rounded-2xl border border-border" />
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onMake} disabled={loading || uploading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {loading ? "Making…" : graphic ? "Make a new picture" : "Make a picture for me"}
        </Button>
        <Button type="button" variant="outline" onClick={onUpload} disabled={uploading || loading}>
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          {uploading ? "Uploading…" : graphic ? "Upload a different picture" : "Upload a picture"}
        </Button>
        {canRestoreAi && (
          <Button type="button" variant="ghost" onClick={onRestoreAi}>
            <Sparkles aria-hidden />
            Use the picture we made
          </Button>
        )}
        {graphic && (
          <Button type="button" variant="ghost" onClick={onRemove} disabled={loading || uploading}>
            <Trash2 aria-hidden />
            Remove picture
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        It shows in the app and on Facebook. JPG, PNG or WebP, never cropped.
      </p>
      {aiStale && (
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The details changed after this picture was made. Make a new one so it matches.
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FacebookScheduleField({
  timing,
  edited,
  onChange,
}: {
  timing: FacebookTimingView;
  edited: boolean;
  onChange: (value: string) => void;
}) {
  const check = checkFacebookScheduleTime(timing.ms);
  const [date = "", time = ""] = timing.value.split("T");
  const emit = (nextDate: string, nextTime: string) => {
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  };
  const hint =
    timing.adjusted === "none"
      ? "The day before, at your usual Facebook post time."
      : timing.adjusted === "too-soon"
        ? "It's too late for the day before, so this is the soonest Facebook allows."
        : timing.adjusted === "too-far"
          ? "Facebook schedules posts up to 30 days ahead, so this is the latest it allows."
          : null;

  return (
    <div className="flex flex-col gap-2 pl-8">
      <div className="grid max-w-md grid-cols-[1fr_auto] gap-3">
        <Input
          type="date"
          aria-label="Facebook post day"
          value={date}
          onChange={(e) => emit(e.target.value, time)}
          className="min-w-0 tabular-nums"
        />
        <Input
          type="time"
          aria-label="Facebook post time"
          value={time}
          onChange={(e) => emit(date, e.target.value)}
          className="w-[9.5rem] min-w-0 tabular-nums"
        />
      </div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {timing.zoneName && (
        <p className="text-sm text-muted-foreground">{`Times are ${timing.zoneName}, your church's time zone.`}</p>
      )}
      {edited && !check.ok && (
        <p role="alert" className="text-sm text-destructive">
          {check.error}
        </p>
      )}
    </div>
  );
}

