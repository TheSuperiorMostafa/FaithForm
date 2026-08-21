"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { hideChatMessage } from "@/lib/stream/chat";

export type MediaActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

export async function hideStreamChatMessage(
  messageId: string,
): Promise<MediaActionState> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) {
    return { ok: false, error: "Only church admins can moderate chat." };
  }

  // Chat belongs to the broadcast, not the media library — this action lives
  // under /dashboard/media only because that is where the moderation UI sits.
  const featureError = await featureActionError("live_stream");
  if (featureError) {
    return { ok: false, error: featureError };
  }

  try {
    await hideChatMessage(messageId, auth.churchId);
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
