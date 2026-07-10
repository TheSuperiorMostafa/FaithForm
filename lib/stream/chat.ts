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
  supabase?: SupabaseClient,
): Promise<ChatMessage[]> {
  const client = supabase ?? createAdminClient();
  const { data, error } = await client
    .from("stream_chat_messages")
    .select("id, author_name, body, created_at")
    .eq("stream_event_id", streamEventId)
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);
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
  const { error } = await client.from("stream_chat_messages").insert({
    stream_event_id: input.streamEventId,
    church_id: input.churchId,
    user_id: input.userId ?? null,
    author_name: input.authorName.slice(0, 80),
    body: input.body.slice(0, 500),
  });

  if (error) throw new Error(error.message);
}

export async function hideChatMessage(
  messageId: string,
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createAdminClient();
  const { error } = await client
    .from("stream_chat_messages")
    .update({ hidden: true })
    .eq("id", messageId);

  if (error) throw new Error(error.message);
}
