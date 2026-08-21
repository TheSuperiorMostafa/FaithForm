import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChatMessage = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export async function listChatMessages(
  streamEventId: string,
  churchId: string,
  supabase?: SupabaseClient,
): Promise<ChatMessage[]> {
  const client = supabase ?? createAdminClient();
  const { data, error } = await client
    .from("stream_chat_messages")
    .select("id, author_name, body, created_at")
    .eq("stream_event_id", streamEventId)
    .eq("church_id", churchId)
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error("Chat is unavailable.");
  return (data ?? []).map((row) => ({
    id: row.id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function postChatMessage(
  input: {
    streamEventId: string;
    churchId: string;
    authorName: string;
    body: string;
    userId?: string | null;
  },
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createAdminClient();
  const { data: event } = await client
    .from("stream_events")
    .select("id")
    .eq("id", input.streamEventId)
    .eq("church_id", input.churchId)
    .eq("status", "live")
    .eq("chat_enabled", true)
    .eq("public_access", true)
    .maybeSingle();
  if (!event?.id) throw new Error("Chat is unavailable.");

  const { error } = await client.from("stream_chat_messages").insert({
    stream_event_id: input.streamEventId,
    church_id: input.churchId,
    user_id: input.userId ?? null,
    author_name: input.authorName.slice(0, 80),
    body: input.body.slice(0, 500),
  });

  if (error) throw new Error("Chat is unavailable.");
}

export async function hideChatMessage(
  messageId: string,
  churchId: string,
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createAdminClient();
  const { error } = await client
    .from("stream_chat_messages")
    .update({ hidden: true })
    .eq("id", messageId)
    .eq("church_id", churchId);

  if (error) throw new Error("Could not moderate message.");
}
