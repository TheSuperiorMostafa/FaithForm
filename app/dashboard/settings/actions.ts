"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { upsertFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { upsertAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import { upsertChurchSettings } from "@/lib/queries/sermons";
import {
  DEFAULT_ANNOUNCEMENT_EMAIL_BODY,
  DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT,
  validateAnnouncementEmailTemplate,
} from "@/lib/email/announcement-template";
import {
  DEFAULT_FOLLOW_UP_TEMPLATES,
  FOLLOW_UP_TEMPLATE_COUNT,
  validateFollowUpTemplates,
} from "@/lib/sms/follow-up-messages";
import type { AIProvider, SermonBuilderMode } from "@/types/sermon";

export type SettingsFormState = {
  ok: boolean;
  error?: string;
};

export async function updateAISettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can change AI settings." };
  }

  const ai_provider = formData.get("ai_provider")?.toString() as AIProvider;
  if (ai_provider !== "anthropic" && ai_provider !== "openai") {
    return { ok: false, error: "Invalid provider." };
  }

  const sermon_builder_mode = formData
    .get("sermon_builder_mode")
    ?.toString() as SermonBuilderMode;
  if (sermon_builder_mode !== "simple" && sermon_builder_mode !== "advanced") {
    return { ok: false, error: "Invalid sermon builder mode." };
  }

  try {
    await upsertChurchSettings(auth.churchId, {
      ai_provider,
      sermon_builder_mode,
      preaching_style: formData.get("preaching_style")?.toString() || null,
      ai_model_override:
        formData.get("ai_model_override")?.toString().trim() || null,
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/church-profile");
    revalidatePath("/dashboard/sermon-builder");
    revalidatePath("/dashboard/sermon-builder/new");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save settings.",
    };
  }
}

export async function updateFollowUpMessages(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change follow-up messages.",
    };
  }

  const featureError = await featureActionError("attendance");
  if (featureError) return { ok: false, error: featureError };

  const reset = formData.get("reset")?.toString() === "1";
  const templates = reset
    ? [...DEFAULT_FOLLOW_UP_TEMPLATES]
    : Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, (_, index) =>
        formData.get(`message_${index}`)?.toString() ?? "",
      );

  const validated = validateFollowUpTemplates(templates);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  try {
    await upsertFollowUpMessageTemplates(
      auth.churchId,
      validated.templates,
    );
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/attendance");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save messages.",
    };
  }
}

export async function updateAnnouncementEmailSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change announcement email settings.",
    };
  }

  const featureError = await featureActionError("announcements");
  if (featureError) return { ok: false, error: featureError };

  const reset = formData.get("reset")?.toString() === "1";
  const subject = reset
    ? DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT
    : (formData.get("announcement_email_subject")?.toString() ?? "");
  const body = reset
    ? DEFAULT_ANNOUNCEMENT_EMAIL_BODY
    : (formData.get("announcement_email_body")?.toString() ?? "");
  const toRaw = reset
    ? ""
    : (formData.get("announcement_email_to")?.toString() ?? "");
  const to = toRaw.trim() || null;
  const weeklyEmailEnabled = reset
    ? true
    : formData.get("weekly_email_enabled")?.toString() === "true";

  const validated = validateAnnouncementEmailTemplate(subject, body, to);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  try {
    await upsertAnnouncementEmailSettings(auth.churchId, {
      subject,
      body,
      to,
      weeklyEmailEnabled,
    });
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/announcements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save email template.",
    };
  }
}
