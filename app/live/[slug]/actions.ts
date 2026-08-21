"use server";

import { postChatMessage } from "@/lib/stream/chat";
import { headers } from "next/headers";
import { z } from "zod";
import { getChurchBySlug } from "@/lib/queries/giving";
import { assertRateLimit, getClientIp } from "@/lib/security/rate-limit";

export type ChatActionState = {
  ok: boolean;
  error?: string;
};

const chatSchema = z.object({
  streamEventId: z.string().uuid(),
  slug: z.string().trim().min(1).max(100),
  authorName: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(500),
});

export async function postStreamChatMessage(input: {
  streamEventId: string;
  slug: string;
  authorName: string;
  body: string;
}): Promise<ChatActionState> {
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid chat message." };

  try {
    const requestHeaders = await headers();
    const ip = getClientIp(new Request("http://internal", { headers: requestHeaders }));
    const rate = await assertRateLimit(
      `stream-chat:${ip}:${parsed.data.slug}`,
      { limit: 10, windowMs: 60_000 },
    );
    if (!rate.ok) return { ok: false, error: "Please wait before posting again." };

    const church = await getChurchBySlug(parsed.data.slug);
    if (!church) return { ok: false, error: "Chat is unavailable." };

    await postChatMessage({
      streamEventId: parsed.data.streamEventId,
      churchId: church.churchId,
      authorName: parsed.data.authorName,
      body: parsed.data.body,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not send message." };
  }
}
