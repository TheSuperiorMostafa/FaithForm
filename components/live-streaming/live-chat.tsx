"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageSquare, Send } from "lucide-react";
import { postStreamChatMessage } from "@/app/live/[slug]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LiveChatProps = {
  streamEventId: string;
  slug: string;
  enabled: boolean;
};

type ChatMessage = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export function LiveChat({ streamEventId, slug, enabled }: LiveChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      const res = await fetch(
        `/api/stream/chat?eventId=${encodeURIComponent(streamEventId)}&slug=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessages(data.messages ?? []);
    };

    void poll();
    const id = setInterval(() => void poll(), 4000);
    return () => clearInterval(id);
  }, [enabled, streamEventId, slug]);

  if (!enabled) return null;

  const send = () => {
    if (!authorName.trim() || !body.trim()) return;
    startTransition(async () => {
      const result = await postStreamChatMessage({
        streamEventId,
        slug,
        authorName: authorName.trim(),
        body: body.trim(),
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not send message.");
        return;
      }
      setBody("");
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" />
        Live chat
      </h2>
      <div className="mb-3 max-h-48 space-y-2 overflow-y-auto text-sm">
        {messages.map((msg) => (
          <div key={msg.id}>
            <span className="font-medium">{msg.authorName}: </span>
            <span className="text-muted-foreground">{msg.body}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="Your name"
          className="sm:max-w-[140px]"
        />
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say something…"
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Button type="button" size="icon" disabled={pending} onClick={send}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
