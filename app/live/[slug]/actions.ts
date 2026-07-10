"use server";

import { postChatMessage } from "@/lib/stream/chat";

export type ChatActionState = {
  ok: boolean;
  error?: string;
};

export async function postStreamChatMessage(input: {
  streamEventId: string;
  churchId: string;
  authorName: string;
  body: string;
}): Promise<ChatActionState> {
  if (!input.authorName.trim() || !input.body.trim()) {
    return { ok: false, error: "Name and message are required." };
  }

  try {
    await postChatMessage({
      streamEventId: input.streamEventId,
      churchId: input.churchId,
      authorName: input.authorName,
      body: input.body,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not send message.",
    };
  }
}
