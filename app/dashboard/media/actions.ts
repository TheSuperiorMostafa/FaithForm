"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
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
