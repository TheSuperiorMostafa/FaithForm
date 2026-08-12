"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/activity/admin-log";
import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { provisionFacebookLiveForChurch } from "@/lib/integrations/facebook-live";
import { provisionYouTubeLiveForChurch } from "@/lib/integrations/youtube-live";
import { createEncoderPairingCode } from "@/lib/stream/encoder";
import {
  endLiveBroadcast,
  startLiveBroadcast,
} from "@/lib/stream/go-live";
import {
  cancelStreamEvent,
  createStreamEvent,
} from "@/lib/stream/events";
import {
  rotateStreamRelayKey,
  saveStreamRelaySettings,
} from "@/lib/stream/relay";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { createAdminClient } from "@/lib/supabase/admin";

export type StreamRelayActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  publishKey?: string | null;
  streamName?: string | null;
};

function revalidateLiveStreaming() {
  revalidatePath("/dashboard/live-streaming");
  revalidatePath("/dashboard/settings");
}

/**
 * Signed in, and Live Stream actually turned on for this church.
 *
 * Every action below goes through here rather than calling getChurchAuth()
 * directly. These actions provision YouTube and Facebook broadcasts, rotate
 * publish keys and start relays — real spend on our infrastructure — so a
 * church whose broadcast feature is off must not be able to reach them by
 * replaying a form post from a page they used to have.
 *
 * The admin check stays in each action, because the wording is specific to
 * what it does and that is worth keeping.
 */
async function requireStreamAccess(): Promise<
  { ok: true; auth: ChurchAuth } | { ok: false; error: string }
> {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "Not signed in." };

  const featureError = await featureActionError("live_stream");
  if (featureError) return { ok: false, error: featureError };

  return { ok: true, auth };
}

export async function updateStreamRelaySettings(
  _prev: StreamRelayActionState,
  formData: FormData,
): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can change stream settings." };
  }

  try {
    const settings = await saveStreamRelaySettings({
      churchId: auth.churchId,
      userId: auth.userId,
      youtubeUrl: formData.get("youtube_url")?.toString() ?? "",
      facebookUrl: formData.get("facebook_url")?.toString() ?? "",
      relayHost: formData.get("relay_host")?.toString() ?? "",
    });

    await logAdminAction({
      churchId: auth.churchId,
      taskName: "Updated live stream relay settings",
      triggerSource: "Live Streaming",
    });

    revalidateLiveStreaming();
    return {
      ok: true,
      message: "Live streaming settings saved.",
      publishKey: settings.publishKey,
      streamName: settings.streamName,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save live streaming settings.",
    };
  }
}

export async function provisionPlatformLiveStreaming(
  platform: "youtube" | "facebook",
): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can set up live streaming." };
  }

  try {
    if (platform === "youtube") {
      await provisionYouTubeLiveForChurch(auth.churchId, auth.userId);
    } else {
      await provisionFacebookLiveForChurch(auth.churchId, auth.userId);
    }

    revalidateLiveStreaming();
    return {
      ok: true,
      message:
        platform === "youtube"
          ? "YouTube live stream is ready."
          : "Facebook live stream is ready.",
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not set up live streaming.",
    };
  }
}

export async function createStreamingPcPairingCode(): Promise<
  StreamRelayActionState & {
    pairingCode?: string;
    expiresAt?: string;
  }
> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can pair encoders." };
  }

  try {
    const result = await createEncoderPairingCode(
      auth.churchId,
      auth.userId,
    );
    revalidateLiveStreaming();
    return {
      ok: true,
      message: "Pairing code created.",
      pairingCode: result.pairingCode,
      expiresAt: result.expiresAt,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not create pairing code.",
    };
  }
}

export async function goLiveBroadcast(
  title?: string,
): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can go live." };
  }

  try {
    await startLiveBroadcast(auth.churchId, auth.userId, { title });
    await logAdminAction({
      churchId: auth.churchId,
      taskName: "Started live broadcast",
      triggerSource: "Live Streaming",
    });
    revalidateLiveStreaming();
    return { ok: true, message: "Broadcast started." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not start broadcast.",
    };
  }
}

export async function endLiveBroadcastAction(): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can end broadcasts." };
  }

  try {
    await endLiveBroadcast(auth.churchId);
    await logAdminAction({
      churchId: auth.churchId,
      taskName: "Ended live broadcast",
      triggerSource: "Live Streaming",
    });
    revalidateLiveStreaming();
    return { ok: true, message: "Broadcast ended." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not end broadcast.",
    };
  }
}

export async function createScheduledStream(
  formData: FormData,
): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can schedule streams." };
  }

  const title = formData.get("title")?.toString().trim();
  const startsAtRaw = formData.get("starts_at")?.toString().trim();
  if (!title || !startsAtRaw) {
    return { ok: false, error: "Title and start time are required." };
  }

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, error: "Invalid start time." };
  }

  try {
    const simulatedFile = formData.get("simulated_video");
    let simulatedSourcePath: string | null = null;

    if (simulatedFile instanceof File && simulatedFile.size > 0) {
      const admin = createAdminClient();
      const ext = simulatedFile.name.split(".").pop() || "mp4";
      const storagePath = `${auth.churchId}/simulated/${Date.now()}.${ext}`;
      const buffer = Buffer.from(await simulatedFile.arrayBuffer());
      const { error: uploadError } = await admin.storage
        .from(STREAM_RECORDINGS_BUCKET)
        .upload(storagePath, buffer, {
          contentType: simulatedFile.type || "video/mp4",
          upsert: false,
        });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      simulatedSourcePath = storagePath;
    }

    await createStreamEvent({
      churchId: auth.churchId,
      title,
      startsAt: startsAt.toISOString(),
      recurrenceRule: formData.get("recurrence_weekly") ? "weekly" : null,
      syndicateYoutube: formData.get("syndicate_youtube") === "on",
      syndicateFacebook: formData.get("syndicate_facebook") === "on",
      chatEnabled: formData.get("chat_enabled") === "on",
      countdownEnabled: formData.get("countdown_enabled") === "on",
      simulated: Boolean(simulatedSourcePath),
      simulatedSourcePath,
      createdBy: auth.userId,
    });

    revalidateLiveStreaming();
    return { ok: true, message: "Service scheduled." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not schedule stream.",
    };
  }
}

export async function cancelScheduledStream(
  eventId: string,
): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can cancel streams." };
  }

  try {
    await cancelStreamEvent(eventId);
    revalidateLiveStreaming();
    return { ok: true, message: "Scheduled stream cancelled." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not cancel stream.",
    };
  }
}

export async function regenerateStreamRelayKey(): Promise<StreamRelayActionState> {
  const gate = await requireStreamAccess();
  if (!gate.ok) return { ok: false, error: gate.error };
  const auth = gate.auth;
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can rotate stream keys." };
  }

  try {
    const settings = await rotateStreamRelayKey(auth.churchId, auth.userId);

    await logAdminAction({
      churchId: auth.churchId,
      taskName: "Regenerated live stream key",
      triggerSource: "Live Streaming",
    });

    revalidateLiveStreaming();
    return {
      ok: true,
      message: "Stream key regenerated.",
      publishKey: settings.publishKey,
      streamName: settings.streamName,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not regenerate stream key.",
    };
  }
}
