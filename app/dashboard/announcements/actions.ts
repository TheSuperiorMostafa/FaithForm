"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";
import { createWeeklyAnnouncementGmailDraft } from "@/lib/announcements/weekly-email";
import { getChurchAuth } from "@/lib/auth/church";
import { createClient } from "@/lib/supabase/server";
import { patchCalendarEvent } from "@/lib/integrations/google-calendar";
import { generateEmergencySocialGraphic, downloadSocialGraphic } from "@/lib/social/generate-graphic";
import {
  postAnnouncementToFacebookPage,
  resolveFacebookScheduledPublishTime,
} from "@/lib/integrations/facebook";
import {
  buildFacebookPostMessage,
  formatDateTimeRange,
} from "@/lib/queries/announcements";
import { getChurchAnnouncementFacebookSchedule } from "@/lib/queries/church-profile";
import { hasIntegration } from "@/lib/integrations/tokens";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import type { PublishResult } from "@/lib/integrations/types";

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

function parsePublishForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const startAt = String(formData.get("start_at") ?? "");
  const endAtRaw = formData.get("end_at");
  const endAt = endAtRaw ? String(endAtRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim();
  const googleEventId = String(formData.get("google_event_id") ?? "").trim() || null;
  const googleCalendarId =
    String(formData.get("google_calendar_id") ?? "").trim() || "primary";
  const announcementId = String(formData.get("announcement_id") ?? "").trim() || null;

  const pushToFacebook = formData.get("push_to_facebook") === "true";
  const pushToTeam = formData.get("push_to_team") === "true";
  const facebookCaption = String(formData.get("facebook_caption") ?? "").trim();
  const socialGraphicPath = String(formData.get("social_graphic_path") ?? "").trim();
  const socialGraphicUrl = String(formData.get("social_graphic_url") ?? "").trim();

  const originalTitle = String(formData.get("original_title") ?? "").trim();
  const originalLocation = String(formData.get("original_location") ?? "").trim();
  const originalStartAt = String(formData.get("original_start_at") ?? "").trim();
  const originalEndAt = String(formData.get("original_end_at") ?? "").trim();

  if (!title) return { ok: false as const, error: "Title is required" };
  if (!startAt) return { ok: false as const, error: "Start time is required" };
  if (endAt && new Date(endAt) <= new Date(startAt)) {
    return { ok: false as const, error: "End must be after start" };
  }

  const calendarChanged =
    Boolean(googleEventId) &&
    (title !== originalTitle ||
      location !== originalLocation ||
      startAt !== originalStartAt ||
      (endAt ?? "") !== originalEndAt);

  return {
    ok: true as const,
    payload: {
      title,
      location,
      startAt,
      endAt,
      notes,
      googleEventId,
      googleCalendarId,
      announcementId,
      pushToFacebook,
      pushToTeam,
      calendarChanged,
      facebookCaption,
      socialGraphicPath,
      socialGraphicUrl,
    },
  };
}

export async function publishAnnouncement(
  formData: FormData,
): Promise<PublishResult> {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) {
    return { ok: false, errors: ["No church linked"] };
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
    facebook_caption: payload.pushToFacebook ? payload.facebookCaption || null : null,
    social_graphic_path: payload.pushToFacebook ? payload.socialGraphicPath || null : null,
    social_graphic_url: payload.pushToFacebook ? payload.socialGraphicUrl || null : null,
    social_preview_generated_at: payload.pushToFacebook
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
    event_date: payload.startAt,
    event_location: payload.location || null,
    push_to_facebook: payload.pushToFacebook,
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

  function isMissingSocialColumnError(message: string): boolean {
    return /facebook_caption|social_graphic_|social_preview_generated_at/i.test(
      message,
    );
  }

  function rowWithoutSocialFields(data: typeof row) {
    const {
      facebook_caption: _c,
      social_graphic_path: _p,
      social_graphic_url: _u,
      social_preview_generated_at: _t,
      ...baseRow
    } = data;
    return baseRow;
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

      if (error && isMissingSocialColumnError(error.message)) {
        ({ error } = await ctx.supabase
          .from("announcements")
          .update(rowWithoutSocialFields(data))
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

    if (error && isMissingSocialColumnError(error.message)) {
      ({ data: inserted, error } = await ctx.supabase
        .from("announcements")
        .insert({ ...rowWithoutSocialFields(data), created_by: ctx.user!.id })
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
      errors: [saved.error ?? "Could not save announcement"],
    };
  }

  announcementId = saved.id;

  if (payload.pushToFacebook) {
    const fbConnected = await hasIntegration(
      ctx.churchId,
      "facebook",
      ctx.supabase,
    );
    if (!fbConnected) {
      errors.push("Facebook is not connected — skipped post.");
    } else {
      try {
        let message = payload.facebookCaption;
        let imagePng: ArrayBuffer | undefined;

        if (payload.socialGraphicPath) {
          if (!payload.socialGraphicPath.startsWith(`${ctx.churchId}/`)) {
            throw new Error("Invalid social graphic path");
          }
          imagePng = await downloadSocialGraphic(payload.socialGraphicPath);
        }

        if (!message) {
          message = buildFacebookPostMessage({
            title: payload.title,
            location: payload.location,
            startAt: payload.startAt,
            endAt: payload.endAt,
            notes: payload.notes,
          });
        }

        if (!imagePng) {
          imagePng = await generateEmergencySocialGraphic(ctx.supabase, ctx.churchId, {
            title: payload.title,
            when: formatDateTimeRange(payload.startAt, payload.endAt),
            location: payload.location,
            startAt: payload.startAt,
            endAt: payload.endAt,
          });
        }

        const scheduledPublishTime = resolveFacebookScheduledPublishTime(
          payload.startAt,
          await getChurchAnnouncementFacebookSchedule(
            ctx.churchId,
            ctx.supabase,
          ),
        );

        const result = await postAnnouncementToFacebookPage(
          ctx.churchId,
          {
            message,
            imagePng,
            scheduledPublishTime,
          },
          ctx.supabase,
        );
        facebookPostId = result.postId;
        facebookUrl = result.url;
        if (result.scheduledPublishTime) {
          facebookScheduledAt = result.scheduledPublishTime;
        }
      } catch (err) {
        errors.push(
          err instanceof Error ? err.message : "Facebook post failed",
        );
      }
    }
  }

  if (payload.googleEventId && payload.calendarChanged) {
    const googleConnected = await hasIntegration(
      ctx.churchId,
      "google",
      ctx.supabase,
    );
    if (!googleConnected) {
      errors.push("Google Calendar is not connected — skipped calendar update.");
    } else {
      try {
        await patchCalendarEvent(
          ctx.churchId,
          {
            googleEventId: payload.googleEventId,
            calendarId: payload.googleCalendarId,
            title: payload.title,
            location: payload.location,
            startAt: payload.startAt,
            endAt: payload.endAt,
          },
          ctx.supabase,
        );
      } catch (err) {
        errors.push(
          err instanceof Error ? err.message : "Google Calendar update failed",
        );
      }
    }
  }

  const googleConnected = await hasIntegration(
    ctx.churchId,
    "google",
    ctx.supabase,
  );
  if (payload.pushToTeam && !googleConnected) {
    errors.push("Google is not connected — weekly email not queued.");
  }

  if (facebookPostId || errors.length > 0) {
    await ctx.supabase
      .from("announcements")
      .update({
        facebook_post_id: facebookPostId,
        facebook_scheduled_publish_time: facebookScheduledAt ?? null,
        last_publish_error: errors.length > 0 ? errors.join(" ") : null,
      })
      .eq("id", announcementId)
      .eq("church_id", ctx.churchId);
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
    queuedForWeeklyEmail: payload.pushToTeam && googleConnected,
    errors,
  };
}

export async function createWeeklyAnnouncementDraftAction(options?: {
  force?: boolean;
}) {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId || !ctx.user) return { error: "No church linked" };

  const auth = await getChurchAuth(ctx.supabase);
  if (!auth?.isAdmin) {
    return { error: "Only church admins can create weekly Gmail drafts." };
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

export async function deleteAnnouncement(id: string) {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId) return { error: "No church linked" };

  const { error } = await ctx.supabase
    .from("announcements")
    .delete()
    .eq("id", id)
    .eq("church_id", ctx.churchId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");
  return { success: true };
}

export async function disconnectIntegration(provider: "google" | "facebook") {
  const ctx = await requireChurchAndUser();
  if (!ctx.churchId) return { error: "No church linked" };

  const { deleteIntegration } = await import("@/lib/integrations/tokens");
  await deleteIntegration(ctx.churchId, provider, ctx.supabase);

  revalidatePath("/dashboard/settings");
  return { success: true };
}
