"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import {
  listStreamRecordings,
  updateStreamRecording,
} from "@/lib/stream/recordings";
import { hideChatMessage } from "@/lib/stream/chat";

export type MediaActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

export async function updateRecordingTrim(
  recordingId: string,
  trimStartSec: number,
  trimEndSec: number | null,
): Promise<MediaActionState> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) {
    return { ok: false, error: "Only church admins can edit recordings." };
  }

  try {
    const recordings = await listStreamRecordings(auth.churchId);
    if (!recordings.some((r) => r.id === recordingId)) {
      return { ok: false, error: "Recording not found." };
    }

    await updateStreamRecording(recordingId, {
      trimStartSec,
      trimEndSec,
      status: "ready",
    });
    revalidatePath("/dashboard/media");
    return { ok: true, message: "Trim saved." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save trim.",
    };
  }
}

export async function publishRecording(
  recordingId: string,
  title?: string,
): Promise<MediaActionState> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) {
    return { ok: false, error: "Only church admins can publish recordings." };
  }

  try {
    const recordings = await listStreamRecordings(auth.churchId);
    if (!recordings.some((r) => r.id === recordingId)) {
      return { ok: false, error: "Recording not found." };
    }

    await updateStreamRecording(recordingId, {
      status: "published",
      title: title?.trim() || undefined,
      publishedAt: new Date().toISOString(),
    });
    revalidatePath("/dashboard/media");
    return { ok: true, message: "Recording published." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not publish recording.",
    };
  }
}

export async function hideStreamChatMessage(
  messageId: string,
): Promise<MediaActionState> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) {
    return { ok: false, error: "Only church admins can moderate chat." };
  }

  try {
    await hideChatMessage(messageId);
    revalidatePath("/dashboard/live-streaming");
    return { ok: true, message: "Message hidden." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not hide message.",
    };
  }
}
