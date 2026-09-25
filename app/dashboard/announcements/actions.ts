"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity/log";
import { calendarEditFor } from "@/lib/announcements/calendar-edit";
import {
  checkFacebookScheduleTime,
  suggestFacebookSchedule,
} from "@/lib/announcements/facebook-schedule";
import {
  addToEmailQueue,
  removeFromEmailQueue,
} from "@/lib/announcements/email-queue";
import { facebookPostUrl } from "@/lib/announcements/published-channels";
import {
  createWeeklyAnnouncementGmailDraft,
} from "@/lib/announcements/weekly-email";
import { resolveWeeklyEmailChannel } from "@/lib/announcements/email-delivery";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  applyMobilePublication,
  withdrawMobilePublication,
} from "@/lib/faithform/push/publish-hook";
import { createClient } from "@/lib/supabase/server";
import {
  AppleReconnectRequiredError,
  isAppleEventId,
  isReadOnlyAppleEventId,
} from "@/lib/integrations/apple-calendar";
import {
  deleteChurchCalendarEvent,
  patchChurchCalendarEvent,
} from "@/lib/integrations/calendar";
import { GoogleReconnectRequiredError } from "@/lib/integrations/google-oauth";
import { FacebookReconnectRequiredError } from "@/lib/integrations/facebook-token";
import { generateEmergencySocialGraphic, downloadSocialGraphic } from "@/lib/social/generate-graphic";
import {
  deleteFacebookPost,
  postAnnouncementToFacebookPage,
} from "@/lib/integrations/facebook";
import {
  buildFacebookPostMessage,
  formatDateTimeRange,
  getAnnouncement,
  isMissingFacebookScheduleColumn,
  type AnnouncementRow,
  type MobileVisibility,
} from "@/lib/queries/announcements";
import { getChurchAnnouncementFacebookSchedule } from "@/lib/queries/church-profile";
import { getChurchTimezone } from "@/lib/queries/attendance";
import { hasIntegration } from "@/lib/integrations/tokens";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import type { PublishResult } from "@/lib/integrations/types";
import { getMondayWeekWindowInTimeZone } from "@/lib/utils/calendar";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import {
  cancelEventAttendanceForDeletedEvent,
  syncEventAttendanceDetails,
} from "@/lib/attendance/v2/event-attendance";

/**
 * A provider failure as a sentence a church can act on.
 *
 * Reconnect prompts and the Facebook schedule checks were written for people
 * and pass through; anything else from Facebook, Google or iCloud is logged
 * and replaced with the fallback.
 */
function providerFailure(err: unknown, fallback: string): string {
  if (err instanceof FacebookReconnectRequiredError) {
    return "It wasn't posted on Facebook because Facebook needs to be reconnected. Reconnect it in Settings.";
  }
  if (err instanceof GoogleReconnectRequiredError) {
    return `${fallback.replace(/[.!?]$/, "")}. Google needs to be reconnected in Settings.`;
  }
  if (err instanceof AppleReconnectRequiredError) {
    return `${fallback.replace(/[.!?]$/, "")}. iCloud needs to be reconnected in Settings.`;
  }
  const message = err instanceof Error ? err.message : "";
  if (/^Facebook (needs at least|can only schedule)/.test(message)) {
    return `It wasn't posted on Facebook. ${message}`;
  }
  return toUserError(err, fallback);
}

/** Said when the signed-in account has no church to act for. */
const NO_CHURCH_MESSAGE =
  "Your account isn't connected to a church yet. Ask your church admin for an invite.";

async function requireChurchAndUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) return { supabase, user: null, churchId: null };

  return { supabase, user, churchId };
}

/**
 * When the Facebook post goes out, as the form chose it.
 *
 * `suggested` means the form never said. That is a page opened before the
 * choice existed, and it gets the time today's form would have suggested.
 * None of the three turns into an unannounced "now".
 */
type FacebookTiming =
  | { mode: "now" }
  | { mode: "schedule"; scheduledAtMs: number }
  | { mode: "suggested" };

const facebookTimingSchema = z.object({
  mode: z.enum(["now", "schedule"]),
  // A malformed time falls through to the schedule check, which says what to
  // fix in the same words the form uses.
  scheduledAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
});

function parseFacebookTiming(
  formData: FormData,
): { ok: true; timing: FacebookTiming } | { ok: false; error: string } {
  const mode = formData.get("facebook_post_mode");
  if (mode === null) return { ok: true, timing: { mode: "suggested" } };

  const parsed = facebookTimingSchema.safeParse({
    mode,
    scheduledAt: formData.get("facebook_scheduled_at") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Choose when the Facebook post should go out." };
  }
  if (parsed.data.mode === "now") return { ok: true, timing: { mode: "now" } };

  // Checked in UTC before anything is saved, so a time Facebook would refuse
  // comes back to the form instead of half-publishing the announcement.
  const check = checkFacebookScheduleTime(parsed.data.scheduledAt);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, timing: { mode: "schedule", scheduledAtMs: check.scheduledAtMs } };
}

function parsePublishForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const startAt = String(formData.get("start_at") ?? "");
  const endAtRaw = formData.get("end_at");
  const endAt = endAtRaw ? String(endAtRaw) : null;
  const allDay = formData.get("all_day") === "true";
  const notes = String(formData.get("notes") ?? "").trim();
  const googleEventId = String(formData.get("google_event_id") ?? "").trim() || null;
  // An announcement that is not about an event ("Office closed"). It still has
  // a start — today, all day — so the app lists it; `event_date` stays empty so
  // nothing treats it as an event.
  const undated = !googleEventId && formData.get("undated") === "true";
  const googleCalendarId =
    String(formData.get("google_calendar_id") ?? "").trim() || "primary";
  const announcementId = String(formData.get("announcement_id") ?? "").trim() || null;

  const pushToFacebook = formData.get("push_to_facebook") === "true";
  const pushToTeam = formData.get("push_to_team") === "true";
  // Changing an announcement that is already on Facebook: the post stays, and
  // is not made again.
  const alreadyOnFacebook = formData.get("already_on_facebook") === "true";
  const facebookCaption = String(formData.get("facebook_caption") ?? "").trim();
  const socialGraphicPath = String(formData.get("social_graphic_path") ?? "").trim();
  const socialGraphicUrl = String(formData.get("social_graphic_url") ?? "").trim();

  // FaithForm publication. Absent means "not in the app" — a publish that does
  // not mention the app must not start appearing in it.
  const mobileVisibilityRaw = String(formData.get("mobile_visibility") ?? "none").trim();
  const mobileVisibility = (
    ["none", "public", "followers", "members"] as const
  ).includes(mobileVisibilityRaw as never)
    ? (mobileVisibilityRaw as "none" | "public" | "followers" | "members")
    : "none";
  const isPinned = formData.get("is_pinned") === "true";
  const pinnedUntil = String(formData.get("pinned_until") ?? "").trim() || null;
  const posterAltText = String(formData.get("poster_alt_text") ?? "").trim() || null;

  const originalTitle = String(formData.get("original_title") ?? "").trim();
  const originalLocation = String(formData.get("original_location") ?? "").trim();
  const originalStartAt = String(formData.get("original_start_at") ?? "").trim();
  const originalEndAt = String(formData.get("original_end_at") ?? "").trim();

  if (!title) return { ok: false as const, error: "Give the announcement a title." };
  if (!startAt || Number.isNaN(Date.parse(startAt))) {
    return { ok: false as const, error: "Choose the day it's happening." };
  }
  if (endAt && new Date(endAt) <= new Date(startAt)) {
    return { ok: false as const, error: "The end time needs to be after the start time." };
  }

  const facebookTiming = parseFacebookTiming(formData);
  if (pushToFacebook && !facebookTiming.ok) {
    return { ok: false as const, error: facebookTiming.error };
  }

  const calendarEdit = calendarEditFor({
    title,
    location,
    startAt,
    endAt,
    allDay,
    original: {
      title: originalTitle,
      location: originalLocation,
      startAt: originalStartAt,
      endAt: originalEndAt,
    },
  });

  return {
    ok: true as const,
    payload: {
      title,
      location,
      startAt,
      endAt,
      allDay,
      notes,
      googleEventId,
      googleCalendarId,
      announcementId,
      undated,
      pushToFacebook: pushToFacebook && !alreadyOnFacebook,
      alreadyOnFacebook,
      pushToTeam,
      calendarChanged: Boolean(googleEventId) && calendarEdit.changed,
      calendarEndAt: calendarEdit.endAt,
      facebookCaption,
      facebookTiming: facebookTiming.ok
        ? facebookTiming.timing
        : ({ mode: "suggested" } as FacebookTiming),
      socialGraphicPath,
      socialGraphicUrl,
      mobileVisibility,
      isPinned,
      pinnedUntil,
      posterAltText,
    },
  };
}

/**
 * Posts one event to the church's Facebook Page, when the form chose.
 *
 * Throws with a message the form can show as it is. Recording the post id
 * against the announcement is left to the caller.
 */
async function postEventToFacebook(
  ctx: { supabase: ReturnType<typeof createClient>; churchId: string },
  input: {
    title: string;
    location: string;
    startAt: string;
    endAt: string | null;
    allDay: boolean;
    notes: string;
    caption: string;
    socialGraphicPath: string;
    timing: FacebookTiming;
  },
): Promise<{ postId: string; url: string; scheduledAt?: string }> {
  const fbConnected = await hasIntegration(ctx.churchId, "facebook", ctx.supabase);
  if (!fbConnected) {
    throw new UserFacingError(
      "It wasn't posted on Facebook because Facebook isn't connected. Connect it in Settings.",
    );
  }

  let message = input.caption;
  // An AI-made flyer or the church's own upload. Facebook is told its real
  // type from its bytes.
  let image: ArrayBuffer | undefined;

  if (input.socialGraphicPath) {
    if (!input.socialGraphicPath.startsWith(`${ctx.churchId}/`)) {
      throw new UserFacingError(
        "It wasn't posted on Facebook because the picture couldn't be found. Choose the picture again.",
      );
    }
    image = await downloadSocialGraphic(input.socialGraphicPath);
  }

  // Server actions run in UTC — dates must render in the church's zone.
  const timeZone = await getChurchTimezone(ctx.supabase, ctx.churchId);

  if (!message) {
    message = buildFacebookPostMessage({
      title: input.title,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      notes: input.notes,
      timeZone,
      allDay: input.allDay,
    });
  }

  if (!image) {
    image = await generateEmergencySocialGraphic(ctx.supabase, ctx.churchId, {
      title: input.title,
      when: formatDateTimeRange(input.startAt, input.endAt, timeZone, input.allDay),
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay,
    });
  }

  // The form chose: a time already checked, or now. A form that never said
  // gets the time today's form would suggest. Posting now is never a fallback
  // for a time that did not work.
  let publishAtMs: number | undefined;
  if (input.timing.mode === "schedule") {
    publishAtMs = input.timing.scheduledAtMs;
  } else if (input.timing.mode === "suggested") {
    const schedule = await getChurchAnnouncementFacebookSchedule(
      ctx.churchId,
      ctx.supabase,
    );
    const suggestion = suggestFacebookSchedule({
      startAt: input.startAt,
      allDay: input.allDay,
      timeZone: schedule.timezone,
      postTime: schedule.postTime,
    });
    if (suggestion?.mode === "schedule") {
      publishAtMs = suggestion.scheduledAtMs;
    }
  }

  const result = await postAnnouncementToFacebookPage(
    ctx.churchId,
    {
      message,
      image,
      scheduledPublishTime:
        publishAtMs === undefined ? undefined : Math.floor(publishAtMs / 1000),
    },
    ctx.supabase,
  );

  return {
    postId: result.postId,
    url: result.url,
    scheduledAt: result.scheduledPublishTime ?? undefined,
  };
}

export type PublishAnnouncementResult = PublishResult & {
  /** It is showing in the FaithForm app. */
  inApp?: boolean;
  /** A notification was queued for the people who can see it. */
  notified?: boolean;
};

export async function publishAnnouncement(
  formData: FormData,
): Promise<PublishAnnouncementResult> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) {
    return { ok: false, errors: [NO_CHURCH_MESSAGE] };
  }

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) {
    return { ok: false, errors: [featureError] };
  }

  const parsed = parsePublishForm(formData);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }

  const { payload } = parsed;
  const errors: string[] = [];
  let facebookPostId: string | null = null;
  let facebookUrl: string | undefined;
  let facebookScheduledAt: string | undefined;

  const socialFields = {
    facebook_caption: payload.pushToFacebook
      ? payload.facebookCaption || null
      : payload.alreadyOnFacebook
        ? payload.facebookCaption || null
        : null,
    // The flyer is the app poster. Persist it whenever we have one, not only
    // when Facebook is on — otherwise a calendar publish never has a thumbnail.
    social_graphic_path: payload.socialGraphicPath || null,
    social_graphic_url: payload.socialGraphicUrl || null,
    social_preview_generated_at: payload.socialGraphicPath
      ? new Date().toISOString()
      : null,
  };

  const row = {
    church_id: ctx.churchId,
    title: payload.title,
    event_title: payload.title,
    body: payload.notes,
    notes: payload.notes || null,
    start_at: payload.startAt,
    end_at: payload.endAt,
    all_day: payload.allDay,
    event_date: payload.undated ? null : payload.startAt,
    event_location: payload.location || null,
    // Asked for now, or already there from an earlier publish.
    push_to_facebook: payload.pushToFacebook || payload.alreadyOnFacebook,
    push_to_app: false,
    push_to_team: payload.pushToTeam,
    status: "published" as const,
    is_ready: true,
    google_event_id: payload.googleEventId,
    google_calendar_id: payload.googleCalendarId,
    published_at: new Date().toISOString(),
    published_by: ctx.user.id,
    last_publish_error: null,
    ...socialFields,
  };

  // Both groups belong to migrations a database may not have yet — the social
  // preview columns to 0023, `all_day` to 0066. Naming an absent column makes
  // PostgREST reject the whole write, so whichever group the error names is
  // dropped and the write retried. Losing the flyer metadata or the all-day
  // flag beats losing the announcement.
  function isMissingOptionalColumnError(message: string): boolean {
    return /facebook_caption|social_graphic_|social_preview_generated_at|all_day/i.test(
      message,
    );
  }

  function rowWithoutMissingColumns(data: typeof row, message: string) {
    const rest: Record<string, unknown> = { ...data };

    if (/facebook_caption|social_graphic_|social_preview_generated_at/i.test(message)) {
      delete rest.facebook_caption;
      delete rest.social_graphic_path;
      delete rest.social_graphic_url;
      delete rest.social_preview_generated_at;
    }
    if (/all_day/i.test(message)) {
      delete rest.all_day;
    }

    return rest;
  }

  async function persistAnnouncement(
    data: typeof row,
    id: string | null,
  ): Promise<{ id: string; error: string | null }> {
    if (id) {
      let { error } = await ctx.supabase
        .from("announcements")
        .update(data)
        .eq("id", id)
        .eq("church_id", ctx.churchId);

      if (error && isMissingOptionalColumnError(error.message)) {
        ({ error } = await ctx.supabase
          .from("announcements")
          .update(rowWithoutMissingColumns(data, error.message))
          .eq("id", id)
          .eq("church_id", ctx.churchId));
      }

      return { id, error: error?.message ?? null };
    }

    let { data: inserted, error } = await ctx.supabase
      .from("announcements")
      .insert({ ...data, created_by: ctx.user!.id })
      .select("id")
      .single();

    if (error && isMissingOptionalColumnError(error.message)) {
      ({ data: inserted, error } = await ctx.supabase
        .from("announcements")
        .insert({
          ...rowWithoutMissingColumns(data, error.message),
          created_by: ctx.user!.id,
        })
        .select("id")
        .single());
    }

    return {
      id: (inserted?.id as string | undefined) ?? "",
      error: error?.message ?? null,
    };
  }

  let announcementId = payload.announcementId;

  if (!announcementId && payload.googleEventId) {
    const { data: existing } = await ctx.supabase
      .from("announcements")
      .select("id")
      .eq("church_id", ctx.churchId)
      .eq("google_event_id", payload.googleEventId)
      .maybeSingle();

    if (existing?.id) {
      announcementId = existing.id as string;
    }
  }

  const saved = await persistAnnouncement(row, announcementId);

  if (saved.error || (!announcementId && !saved.id)) {
    return {
      ok: false,
      errors: [
        toUserError(
          saved.error ? { message: saved.error } : null,
          "We couldn't save this announcement. Nothing was posted",
        ),
      ],
    };
  }

  announcementId = saved.id;

  // The app projection and its notification are applied here — after the
  // canonical row is saved and *before* any external provider is contacted, so
  // a Facebook or calendar failure below can never leave the app half-published
  // or send a notification for something that did not save.
  const mobileResult = await applyMobilePublication({
    churchId: ctx.churchId,
    announcementId,
    title: payload.title,
    body: payload.notes || null,
    visibility: payload.mobileVisibility,
    isPinned: payload.isPinned,
    pinnedUntil: payload.pinnedUntil,
    posterAltText: payload.posterAltText,
    startAt: payload.startAt,
    endAt: payload.endAt,
    allDay: payload.allDay,
  });

  if (!mobileResult.applied && payload.mobileVisibility !== "none") {
    errors.push(
      mobileResult.unavailableReason === "migration_0054_missing"
        ? "Saved. It isn't showing in the app yet because the app connection isn't ready. Contact FaithForm support."
        : "Saved, but it couldn't be posted to the FaithForm app. Try again in a moment.",
    );
  }

  if (payload.pushToFacebook) {
    try {
      const result = await postEventToFacebook(ctx, {
        title: payload.title,
        location: payload.location,
        startAt: payload.startAt,
        endAt: payload.endAt,
        allDay: payload.allDay,
        notes: payload.notes,
        caption: payload.facebookCaption,
        socialGraphicPath: payload.socialGraphicPath,
        timing: payload.facebookTiming,
      });
      facebookPostId = result.postId;
      facebookUrl = result.url;
      facebookScheduledAt = result.scheduledAt;
    } catch (err) {
      errors.push(
        providerFailure(err, "It was saved, but we couldn't post it on Facebook"),
      );
    }
  }

  // An event read through a public iCloud link has nowhere to be written back
  // to. The announcement keeps the edits; the form already said the calendar
  // event itself is changed in Apple Calendar, so this is not an error.
  if (
    payload.googleEventId &&
    payload.calendarChanged &&
    !isReadOnlyAppleEventId(payload.googleEventId)
  ) {
    // The event id says which calendar it came from, so an iCloud event is
    // written back to iCloud rather than looked for in Google.
    const onApple = isAppleEventId(payload.googleEventId);
    const provider = onApple ? "apple" : "google";
    const label = onApple ? "iCloud Calendar" : "Google Calendar";
    const calendarConnected = await hasIntegration(
      ctx.churchId,
      provider,
      ctx.supabase,
    );
    if (!calendarConnected) {
      errors.push(
        `${label} isn't connected, so your calendar event wasn't changed. Reconnect it in Settings.`,
      );
    } else {
      try {
        await patchChurchCalendarEvent(
          ctx.churchId,
          {
            eventId: payload.googleEventId,
            calendarId: payload.googleCalendarId,
            title: payload.title,
            location: payload.location,
            startAt: payload.startAt,
            endAt: payload.calendarEndAt,
            allDay: payload.allDay,
          },
          ctx.supabase,
        );
        await syncEventAttendanceDetails({
          churchId: ctx.churchId,
          actorUserId: ctx.user.id,
          calendarEventId: payload.googleEventId,
          calendarId: payload.googleCalendarId,
          calendarSource: onApple ? "apple" : "google",
          title: payload.title,
          startAt: payload.startAt,
          endAt: payload.calendarEndAt,
          allDay: payload.allDay,
        });
      } catch (err) {
        errors.push(
          providerFailure(
            err,
            `The announcement was saved, but we couldn't update the event in ${label}`,
          ),
        );
      }
    }
  }

  const weeklyEmailChannel = await resolveWeeklyEmailChannel(
    ctx.churchId,
    ctx.supabase,
  );
  if (payload.pushToTeam && !weeklyEmailChannel) {
    errors.push(NO_EMAIL_ACCOUNT_MESSAGE);
  }

  if (facebookPostId || errors.length > 0) {
    // A post id is written only when this publish made one. Changing an
    // announcement that is already on Facebook must not forget that post.
    const publishState: Record<string, unknown> = {
      last_publish_error: errors.length > 0 ? errors.join(" ") : null,
      ...(facebookPostId ? { facebook_post_id: facebookPostId } : {}),
    };

    const { error: stateError } = await ctx.supabase
      .from("announcements")
      .update({
        ...publishState,
        ...(facebookPostId
          ? { facebook_scheduled_publish_time: facebookScheduledAt ?? null }
          : {}),
      })
      .eq("id", announcementId)
      .eq("church_id", ctx.churchId);

    // `facebook_scheduled_publish_time` comes from migration 0014, which
    // production never received. Naming it made PostgREST reject the whole
    // update, so a post that had gone out to Facebook was never recorded
    // against the announcement — it looked like publishing had failed. Drop
    // the schedule time rather than the post id.
    if (stateError && isMissingFacebookScheduleColumn(stateError.message)) {
      await ctx.supabase
        .from("announcements")
        .update(publishState)
        .eq("id", announcementId)
        .eq("church_id", ctx.churchId);
    }
  }

  await logActivity({
    churchId: ctx.churchId,
    automationType: "Publish Announcement",
    category: "Communications",
    taskName: payload.title,
    timeSavedMinutes: 15,
    triggerSource: "announcements_module",
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");

  return {
    ok: true,
    announcementId: announcementId!,
    facebookUrl,
    facebookScheduledAt,
    queuedForWeeklyEmail: payload.pushToTeam && Boolean(weeklyEmailChannel),
    inApp: mobileResult.applied && payload.mobileVisibility !== "none",
    notified: mobileResult.enqueued,
    errors,
  };
}

const NO_EMAIL_ACCOUNT_MESSAGE =
  "It wasn't added to Monday's email because no email account is connected. Connect Google or iCloud in Settings.";

export type FacebookPostDefaults =
  | { ok: true; timeZone: string; postTime: string }
  | { ok: false; error: string };

/**
 * The church's time zone and Church Profile post time.
 *
 * The form uses them to suggest the same Facebook time the server would, and
 * to show it on the church's own clock rather than the viewer's.
 */
export async function getFacebookPostDefaults(): Promise<FacebookPostDefaults> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) return { ok: false, error: NO_CHURCH_MESSAGE };

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { ok: false, error: featureError };

  const schedule = await getChurchAnnouncementFacebookSchedule(
    ctx.churchId,
    ctx.supabase,
  );
  return { ok: true, timeZone: schedule.timezone, postTime: schedule.postTime };
}

export async function createWeeklyAnnouncementDraftAction(options?: {
  force?: boolean;
}) {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) return { error: NO_CHURCH_MESSAGE };

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { error: featureError };

  const auth = await getChurchAuth(ctx.supabase);
  if (!auth?.isAdmin) {
    return { error: "Only church admins can create the weekly email." };
  }

  const result = await createWeeklyAnnouncementGmailDraft(ctx.churchId, {
    force: options?.force,
    supabase: ctx.supabase,
  });

  revalidatePath("/dashboard/announcements");

  if (!result.ok) {
    return { error: result.error, skipped: result.skipped ?? false };
  }

  return {
    success: true,
    draftUrl: result.draftUrl,
    eventCount: result.eventCount,
  };
}

export type UnsubmitAnnouncementResult = {
  success?: true;
  error?: string;
  /** Set when a Facebook post was already live and has been left in place. */
  facebookStillLive?: boolean;
  facebookUrl?: string;
  /** Non-fatal problems, e.g. Facebook rejected the delete. */
  warnings?: string[];
};

/**
 * Rewinds a submitted announcement back to the pending queue.
 *
 * - Clears it from the weekly email (`push_to_team`).
 * - Deletes the Facebook post when it is still *scheduled*.
 * - Leaves an already-published Facebook post alone and says so, rather than
 *   silently removing something members may already have seen.
 *
 * The Google Calendar event is untouched — it is the church's source of truth,
 * and the event still exists whether or not it has been announced.
 */
export async function unsubmitAnnouncement(
  id: string,
): Promise<UnsubmitAnnouncementResult> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) return { error: NO_CHURCH_MESSAGE };

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { error: featureError };

  const auth = await getChurchAuth(ctx.supabase);
  if (!auth?.isAdmin) {
    return { error: "Only church admins can take announcements down." };
  }

  const loadAnnouncement = (columns: string) =>
    ctx.supabase
      .from("announcements")
      .select(columns)
      .eq("id", id)
      .eq("church_id", ctx.churchId)
      .maybeSingle();

  let { data: row, error: loadError } = await loadAnnouncement(
    "id, title, facebook_post_id, facebook_scheduled_publish_time, status",
  );

  // Without 0014 this select fails outright, and unsubmitting reported the
  // announcement as missing.
  if (loadError && isMissingFacebookScheduleColumn(loadError.message)) {
    ({ data: row, error: loadError } = await loadAnnouncement(
      "id, title, facebook_post_id, status",
    ));
  }

  if (loadError) {
    return { error: toUserError(loadError, "We couldn't take this announcement down") };
  }
  if (!row) {
    return {
      error: "We couldn't find that announcement. It may already be taken down. Refresh the page.",
    };
  }

  // The column list is chosen at runtime, so PostgREST cannot infer a shape.
  const announcement = row as unknown as {
    facebook_post_id: string | null;
    facebook_scheduled_publish_time?: string | null;
  };

  const warnings: string[] = [];
  let facebookStillLive = false;
  let facebookUrl: string | undefined;

  const facebookPostId = announcement.facebook_post_id;
  if (facebookPostId) {
    const scheduledAt = announcement.facebook_scheduled_publish_time ?? null;
    const stillScheduled =
      Boolean(scheduledAt) && new Date(scheduledAt!).getTime() > Date.now();

    if (stillScheduled) {
      const result = await deleteFacebookPost(
        ctx.churchId,
        facebookPostId,
        ctx.supabase,
      );
      if (!result.ok) {
        console.error("[announcements] scheduled Facebook post delete failed:", result.error);
        warnings.push(
          "We couldn't cancel the scheduled Facebook post. Delete it on Facebook if you don't want it to go out.",
        );
        facebookStillLive = true;
        facebookUrl = facebookPostUrl(facebookPostId);
      }
    } else {
      facebookStillLive = true;
      facebookUrl = facebookPostUrl(facebookPostId);
    }
  }

  // Taking it back from the web takes it out of the app as well, and cancels
  // anything not yet delivered. Leaving it visible in FaithForm after an
  // unsubmit would be the worst kind of stale.
  await withdrawMobilePublication(ctx.churchId, id).catch(() => undefined);

  const rewind = {
    status: "pending" as const,
    is_ready: false,
    push_to_team: false,
    push_to_facebook: false,
    published_at: null,
    last_publish_error: null,
    // Keep the post id only when the live post survives, so the UI can still
    // link to it and a later re-submit does not create a duplicate reference.
    facebook_post_id: facebookStillLive ? facebookPostId : null,
    facebook_scheduled_publish_time: null,
    unsubmitted_at: new Date().toISOString(),
    unsubmitted_by: ctx.user.id,
  };

  // Drops whichever of the 0014/0041 columns this database is missing. The
  // rewind itself — status, flags, the Facebook post id — always applies.
  function rowWithout(
    data: typeof rewind,
    keys: Array<keyof typeof rewind>,
  ): Partial<typeof rewind> {
    const rest: Partial<typeof rewind> = { ...data };
    for (const key of keys) delete rest[key];
    return rest;
  }

  let { error } = await ctx.supabase
    .from("announcements")
    .update(rewind)
    .eq("id", id)
    .eq("church_id", ctx.churchId);

  if (error && /unsubmitted_(at|by)|facebook_scheduled_publish_time/i.test(error.message)) {
    ({ error } = await ctx.supabase
      .from("announcements")
      .update(
        rowWithout(rewind, [
          "unsubmitted_at",
          "unsubmitted_by",
          "facebook_scheduled_publish_time",
        ]),
      )
      .eq("id", id)
      .eq("church_id", ctx.churchId));
  }

  if (error) {
    return { error: toUserError(error, "We couldn't take this announcement down") };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");

  return {
    success: true,
    facebookStillLive,
    facebookUrl,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function deleteAnnouncement(id: string) {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId) return { error: NO_CHURCH_MESSAGE };

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { error: featureError };

  // Cancel any undelivered notification first: once the row is gone the
  // worker's own re-check would cancel it anyway, but a notification racing a
  // delete should not depend on that ordering.
  await withdrawMobilePublication(ctx.churchId, id).catch(() => undefined);

  const { error } = await ctx.supabase
    .from("announcements")
    .delete()
    .eq("id", id)
    .eq("church_id", ctx.churchId);

  if (error) return { error: toUserError(error, "We couldn't delete this announcement") };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");
  return { success: true };
}

/** Columns a database may be missing: 0014's schedule time, 0023's social preview. */
const OPTIONAL_UPDATE_COLUMNS = [
  "facebook_scheduled_publish_time",
  "facebook_caption",
  "social_graphic_path",
  "social_graphic_url",
  "social_preview_generated_at",
];

/**
 * Updates one announcement, dropping whichever optional columns this database
 * turns out not to have rather than losing the whole write.
 */
async function updateAnnouncementRow(
  supabase: ReturnType<typeof createClient>,
  churchId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const row = { ...data };
  for (let attempt = 0; attempt <= OPTIONAL_UPDATE_COLUMNS.length; attempt++) {
    if (Object.keys(row).length === 0) return null;
    const { error } = await supabase
      .from("announcements")
      .update(row)
      .eq("id", id)
      .eq("church_id", churchId);
    if (!error) return null;

    const missing = Object.keys(row).filter(
      (column) =>
        OPTIONAL_UPDATE_COLUMNS.includes(column) &&
        new RegExp(column, "i").test(error.message),
    );
    if (missing.length === 0) return error.message;
    for (const column of missing) delete row[column];
  }
  return null;
}

export type PublishToMoreChannelsResult = PublishResult & {
  /** The announcement as saved afterwards, so the panel can show where it is now. */
  announcement?: AnnouncementRow;
  /** A notification was queued for the people who can now see it in the app. */
  notified?: boolean;
};

/**
 * Publishes an event that is already out to the places it is not in yet.
 *
 * Only the places asked for, and only those it is missing from. Nothing it is
 * already in is touched: a Facebook post that exists is never posted twice,
 * the app is not re-notified, and the details stay as they were published.
 */
export async function publishToMoreChannels(
  formData: FormData,
): Promise<PublishToMoreChannelsResult> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) {
    return { ok: false, errors: [NO_CHURCH_MESSAGE] };
  }

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { ok: false, errors: [featureError] };

  const announcementId = String(formData.get("announcement_id") ?? "").trim();
  const announcement = announcementId
    ? await getAnnouncement(ctx.supabase, ctx.churchId, announcementId)
    : null;
  if (!announcement) {
    return {
      ok: false,
      errors: ["We couldn't find that announcement. Refresh the page and try again."],
    };
  }
  if (announcement.status !== "published") {
    return { ok: false, errors: ["This announcement isn't posted yet. Post it first."] };
  }

  const inApp = (announcement.mobile_visibility ?? "none") !== "none";
  const visibilityRaw = String(formData.get("mobile_visibility") ?? "none").trim();
  const appVisibility: MobileVisibility =
    visibilityRaw === "public" || visibilityRaw === "followers" || visibilityRaw === "members"
      ? visibilityRaw
      : "none";

  const addFacebook =
    formData.get("push_to_facebook") === "true" && !announcement.facebook_post_id;
  const addTeam = formData.get("push_to_team") === "true" && !announcement.push_to_team;
  const addApp = appVisibility !== "none" && !inApp;

  if (!addFacebook && !addTeam && !addApp) {
    return { ok: false, errors: ["Choose at least one new place to share it."] };
  }

  const timing = parseFacebookTiming(formData);
  if (addFacebook && !timing.ok) return { ok: false, errors: [timing.error] };

  const socialGraphicPath = String(formData.get("social_graphic_path") ?? "").trim();
  const socialGraphicUrl = String(formData.get("social_graphic_url") ?? "").trim();
  if (socialGraphicPath && !socialGraphicPath.startsWith(`${ctx.churchId}/`)) {
    return {
      ok: false,
      errors: ["The picture couldn't be found. Choose the picture again."],
    };
  }

  const errors: string[] = [];
  let notified = false;

  // The saved image is the app poster. A new one replaces it only while the
  // app is not showing it yet; otherwise it goes to Facebook alone.
  if (
    socialGraphicPath &&
    socialGraphicUrl &&
    socialGraphicPath !== announcement.social_graphic_path &&
    (!inApp || !announcement.social_graphic_path)
  ) {
    await updateAnnouncementRow(ctx.supabase, ctx.churchId, announcement.id, {
      social_graphic_path: socialGraphicPath,
      social_graphic_url: socialGraphicUrl,
      social_preview_generated_at: new Date().toISOString(),
    });
  }

  if (addApp) {
    const posterAltText = String(formData.get("poster_alt_text") ?? "").trim() || null;
    const mobileResult = await applyMobilePublication({
      churchId: ctx.churchId,
      announcementId: announcement.id,
      title: announcement.title,
      body: announcement.body || null,
      visibility: appVisibility,
      isPinned: false,
      pinnedUntil: null,
      posterAltText,
      startAt: announcement.start_at,
      endAt: announcement.end_at,
      allDay: Boolean(announcement.all_day),
    });
    notified = mobileResult.enqueued;
    if (!mobileResult.applied) {
      errors.push(
        mobileResult.unavailableReason === "migration_0054_missing"
          ? "The app connection isn't ready yet, so this can't be posted to the app. Contact FaithForm support."
          : "We couldn't post it to the FaithForm app. Try again in a moment.",
      );
    }
  }

  const changes: Record<string, unknown> = {};
  let queuedForWeeklyEmail = false;

  if (addTeam) {
    const weeklyEmailChannel = await resolveWeeklyEmailChannel(
      ctx.churchId,
      ctx.supabase,
    );
    if (weeklyEmailChannel) {
      changes.push_to_team = true;
      queuedForWeeklyEmail = true;
    } else {
      errors.push(NO_EMAIL_ACCOUNT_MESSAGE);
    }
  }

  let facebookUrl: string | undefined;
  let facebookScheduledAt: string | undefined;

  if (addFacebook) {
    const facebookCaption = String(formData.get("facebook_caption") ?? "").trim();
    try {
      const result = await postEventToFacebook(ctx, {
        title: announcement.title,
        location: announcement.event_location ?? "",
        startAt: announcement.start_at,
        endAt: announcement.end_at,
        allDay: Boolean(announcement.all_day),
        notes: announcement.body,
        caption: facebookCaption,
        socialGraphicPath: socialGraphicPath || announcement.social_graphic_path || "",
        timing: timing.ok ? timing.timing : { mode: "suggested" },
      });
      facebookUrl = result.url;
      facebookScheduledAt = result.scheduledAt;
      changes.push_to_facebook = true;
      changes.facebook_post_id = result.postId;
      changes.facebook_caption = facebookCaption || null;
      changes.facebook_scheduled_publish_time = result.scheduledAt ?? null;
    } catch (err) {
      errors.push(providerFailure(err, "We couldn't post it on Facebook"));
    }
  }

  // The note describes this publish. An old failure the church has just
  // fixed, such as Facebook not being connected, should not linger.
  changes.last_publish_error = errors.length > 0 ? errors.join(" ") : null;

  const saveError = await updateAnnouncementRow(
    ctx.supabase,
    ctx.churchId,
    announcement.id,
    changes,
  );
  if (saveError) {
    errors.push(
      toUserError({ message: saveError }, "It was shared, but we couldn't save where it went"),
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");

  const saved = await getAnnouncement(ctx.supabase, ctx.churchId, announcement.id);

  return {
    ok: true,
    announcementId: announcement.id,
    facebookUrl,
    facebookScheduledAt,
    queuedForWeeklyEmail,
    notified,
    errors,
    announcement: saved ?? undefined,
  };
}

export type DeleteCalendarEventResult =
  | {
      ok: true;
      /** Set when a live Facebook post was left up, so the church can remove it. */
      facebookUrl?: string;
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Deletes an event from the church calendar, and takes it down from every
 * place FaithForm published it.
 *
 * The calendar goes first. If it refuses, nothing else is touched, so an event
 * that is still on the calendar never loses its announcement. After that the
 * app listing and any notification not yet sent are withdrawn, a scheduled
 * Facebook post is cancelled, it leaves the weekly email, check-in that has
 * not opened is turned off, and the announcement is deleted. A Facebook post
 * that is already live is deleted only when the church says so.
 */
export async function deleteCalendarEvent(input: {
  eventId: string;
  deleteLiveFacebookPost?: boolean;
}): Promise<DeleteCalendarEventResult> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) return { ok: false, error: NO_CHURCH_MESSAGE };

  const featureError = await featureActionError("announcements", ctx.supabase);
  if (featureError) return { ok: false, error: featureError };

  const auth = await getChurchAuth(ctx.supabase);
  if (!auth?.isAdmin) {
    return { ok: false, error: "Only church admins can delete events." };
  }

  const eventId = input.eventId.trim();
  if (!eventId) return { ok: false, error: "Choose an event to delete." };

  try {
    await deleteChurchCalendarEvent(ctx.churchId, eventId, ctx.supabase);
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError) {
      return { ok: false, error: "Google needs to be reconnected in Settings." };
    }
    if (err instanceof AppleReconnectRequiredError) {
      return { ok: false, error: "iCloud needs to be reconnected in Settings." };
    }
    return {
      ok: false,
      error: toUserError(err, "We couldn't delete this event from your calendar. Nothing was changed"),
    };
  }

  const warnings: string[] = [];
  let facebookUrl: string | undefined;

  const { data: rows } = await ctx.supabase
    .from("announcements")
    .select("id")
    .eq("church_id", ctx.churchId)
    .eq("google_event_id", eventId);

  for (const { id } of (rows ?? []) as { id: string }[]) {
    const announcement = await getAnnouncement(ctx.supabase, ctx.churchId, id);
    const postId = announcement?.facebook_post_id;

    if (postId) {
      const scheduledAt = announcement?.facebook_scheduled_publish_time ?? null;
      const stillScheduled =
        Boolean(scheduledAt) && new Date(scheduledAt!).getTime() > Date.now();

      if (stillScheduled || input.deleteLiveFacebookPost) {
        const result = await deleteFacebookPost(ctx.churchId, postId, ctx.supabase);
        if (!result.ok) {
          console.error("[announcements] Facebook post delete failed:", result.error);
          warnings.push(
            "The event was deleted, but we couldn't remove the Facebook post. Delete it on Facebook.",
          );
          facebookUrl = facebookPostUrl(postId);
        }
      } else {
        facebookUrl = facebookPostUrl(postId);
      }
    }

    await withdrawMobilePublication(ctx.churchId, id).catch(() => undefined);

    const { error } = await ctx.supabase
      .from("announcements")
      .delete()
      .eq("id", id)
      .eq("church_id", ctx.churchId);
    if (error) {
      console.error("[announcements] announcement delete after event delete:", error.message);
      warnings.push(
        "The event was deleted, but its announcement is still listed. Take it down from the list.",
      );
    }
  }

  // Every week's email, not just this one: it may have been queued ahead.
  const { error: queueError } = await ctx.supabase
    .from("announcement_email_queue")
    .delete()
    .eq("church_id", ctx.churchId)
    .eq("google_event_id", eventId);
  if (queueError && !/announcement_email_queue/i.test(queueError.message)) {
    warnings.push("The event was deleted, but it may still be listed in the weekly email.");
  }

  try {
    await cancelEventAttendanceForDeletedEvent({
      churchId: ctx.churchId,
      actorUserId: ctx.user.id,
      calendarEventId: eventId,
    });
  } catch {
    warnings.push("The event was deleted, but its check-in could not be turned off.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");

  return { ok: true, facebookUrl, warnings };
}

// Disconnecting moved to app/dashboard/settings/integration-actions.ts, where
// every provider is handled in one place and admin rights are enforced.

/**
 * Puts an event in — or takes it out of — this week's email.
 *
 * Membership is an explicit choice rather than a consequence of the date, so a
 * church can announce something a fortnight out in this Sunday's email. The
 * queue is keyed on the church-local Monday, which is how it empties itself
 * each week.
 */
export async function toggleEventInWeeklyEmail(input: {
  googleEventId: string;
  calendarId?: string | null;
  included: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = await featureActionError("announcements");
  if (denied) return { ok: false, error: denied };

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) return { ok: false, error: "Please sign in again." };

  const { data: churchRow } = await supabase
    .from("churches")
    .select("timezone")
    .eq("id", auth.churchId)
    .maybeSingle();

  const week = getMondayWeekWindowInTimeZone(
    new Date(),
    (churchRow?.timezone as string | null) ?? null,
  );

  const result = input.included
    ? await addToEmailQueue({
        churchId: auth.churchId,
        weekStartKey: week.weekStartKey,
        googleEventId: input.googleEventId,
        calendarId: input.calendarId ?? null,
        addedBy: auth.userId,
      })
    : await removeFromEmailQueue({
        churchId: auth.churchId,
        weekStartKey: week.weekStartKey,
        googleEventId: input.googleEventId,
      });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "We couldn't change Monday's email. Please try again.",
    };
  }

  revalidatePath("/dashboard/announcements");
  return { ok: true };
}
