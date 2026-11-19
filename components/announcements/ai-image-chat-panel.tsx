"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, Loader2, Pencil, RotateCcw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_IMAGE_CHAT_HISTORY_TURNS,
  MAX_IMAGE_CHAT_INSTRUCTION_CHARS,
  type ImageChatEventContext,
  type ImageChatTurn,
} from "@/lib/ai/image/chat-prompt";
import { describeRequestFailure } from "@/lib/errors/user-error";
import { cn } from "@/lib/utils";

type ChatImage = { mimeType: string; data: string; width: number; height: number };

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "model"; text: string | null; image: ChatImage; version: number };

const EXAMPLES = [
  "A warm harvest table set for a fall potluck, string lights overhead",
  "A quiet sanctuary at sunrise with light through tall windows",
  "Bold, modern youth night graphic in deep blue and orange",
];

const FAILED = "We couldn't make that picture right now";

function toFile(image: ChatImage, version: number): File {
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `ai-picture-${version}.jpg`, { type: image.mimeType });
}

function historyFor(messages: Message[]): ImageChatTurn[] {
  return messages
    .map((m): ImageChatTurn =>
      m.role === "user"
        ? { role: "user", text: m.text }
        : { role: "model", text: m.text || `Made picture ${m.version}.` },
    )
    .slice(-MAX_IMAGE_CHAT_HISTORY_TURNS);
}

/**
 * The event composer's "Create image with AI" panel: a chat down the right
 * side (the whole screen on a phone). The first message creates a picture;
 * each one after that edits the picture being worked on. Every version stays
 * in the thread, and "Use this image" attaches it to the event the same way
 * an uploaded picture is.
 *
 * The conversation is kept only here, in the browser. It survives closing and
 * reopening the panel while the composer stays open.
 */
export function AiImageChatPanel({
  open,
  onOpenChange,
  event,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ImageChatEventContext;
  /** Attaches the picture. Resolves to an error message, or null when it worked. */
  onUse: (file: File) => Promise<string | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, sending]);

  const versions = messages.filter((m): m is Extract<Message, { role: "model" }> => m.role === "model");
  const base = versions.find((m) => m.id === baseId) ?? versions[versions.length - 1] ?? null;

  const send = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || sending) return;
    setError(null);
    setSending(true);

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text: instruction };
    const history = historyFor(messages);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/announcements/image-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          instruction,
          history,
          previousImage: base ? { mimeType: base.image.mimeType, data: base.image.data } : null,
          event,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; image?: ChatImage; note?: string | null }
        | null;
      if (!res.ok || !data?.image) {
        throw new Error(data?.error || describeRequestFailure(FAILED));
      }
      const image = data.image;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: data.note ?? null,
          image,
          version: prev.filter((m) => m.role === "model").length + 1,
        },
      ]);
      // The newest picture is the one the next message edits.
      setBaseId(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && !(err instanceof TypeError || err instanceof SyntaxError) && err.message
          ? err.message
          : describeRequestFailure(FAILED),
      );
      // Give the words back so they can be sent again.
      setInput((current) => current || instruction);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const use = async (message: Extract<Message, { role: "model" }>) => {
    setError(null);
    setUsingId(message.id);
    try {
      const problem = await onUse(toFile(message.image, message.version));
      if (problem) {
        setError(problem);
        return;
      }
      onOpenChange(false);
    } finally {
      setUsingId(null);
    }
  };

  const startOver = () => {
    abortRef.current?.abort();
    setMessages([]);
    setBaseId(null);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  };

  const editing = Boolean(base);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby="ai-image-chat-title"
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-none overflow-hidden rounded-none border-0 sm:max-w-md sm:border-l"
      >
        <DialogHeader className="pr-16">
          <DialogTitle id="ai-image-chat-title">Create image with AI</DialogTitle>
          <DialogDescription>
            Describe the picture you want. Then tell us what to change, one message at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-auto overflow-y-auto px-6 py-5" aria-live="polite">
          {messages.length === 0 && !sending ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-muted-foreground">Try one of these, or write your own:</p>
              {EXAMPLES.map((example) => (
                <Button
                  key={example}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 justify-start whitespace-normal py-2.5 text-left font-normal"
                  onClick={() => {
                    setInput(example);
                    inputRef.current?.focus();
                  }}
                >
                  {example}
                </Button>
              ))}
              <p className="text-sm text-muted-foreground">
                Pictures never show people. Ask for places, objects, colours and words instead.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
                      {message.text}
                    </p>
                  </li>
                ) : (
                  <li key={message.id} className="flex flex-col gap-2">
                    <figure
                      className={cn(
                        "overflow-hidden rounded-2xl border bg-card",
                        base?.id === message.id ? "border-primary ring-2 ring-primary/30" : "border-border",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:${message.image.mimeType};base64,${message.image.data}`}
                        alt={`Picture ${message.version}`}
                        width={message.image.width}
                        height={message.image.height}
                        className="h-auto w-full"
                      />
                      <figcaption className="flex flex-col gap-1 px-4 py-3 text-sm">
                        <span className="font-semibold">
                          Picture {message.version}
                          {base?.id === message.id && (
                            <span className="font-normal text-muted-foreground"> · your next message edits this one</span>
                          )}
                        </span>
                        {message.text && <span className="text-muted-foreground">{message.text}</span>}
                      </figcaption>
                    </figure>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void use(message)}
                        disabled={usingId !== null || sending}
                      >
                        {usingId === message.id ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                        {usingId === message.id ? "Adding…" : "Use this image"}
                      </Button>
                      {base?.id !== message.id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setBaseId(message.id);
                            inputRef.current?.focus();
                          }}
                          disabled={sending}
                        >
                          <Pencil aria-hidden />
                          Edit this one
                        </Button>
                      )}
                    </div>
                  </li>
                ),
              )}
              {sending && (
                <li>
                  <SkeletonContainer label={editing ? "your changes" : "your picture"} className="flex flex-col gap-2">
                    <Skeleton className="aspect-video w-full rounded-2xl" />
                    <p className="text-sm text-muted-foreground">
                      {editing ? "Making your changes…" : "Making your picture…"} This can take up to a minute.
                    </p>
                  </SkeletonContainer>
                </li>
              )}
            </ol>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={onSubmit} className="flex shrink-0 flex-col gap-3 border-t border-border px-6 py-4">
          {error && (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
          <label htmlFor="ai-image-chat-input" className="sr-only">
            {editing ? "What should change?" : "Describe your picture"}
          </label>
          <Textarea
            id="ai-image-chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_IMAGE_CHAT_INSTRUCTION_CHARS}
            rows={2}
            className="min-h-[72px] resize-none"
            placeholder={
              editing
                ? "What should change? For example: make it darker, add the date"
                : "Describe your picture"
            }
            disabled={sending}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {messages.length > 0 ? (
              <Button type="button" variant="ghost" onClick={startOver} disabled={usingId !== null}>
                <RotateCcw aria-hidden />
                Start over
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {sending ? "Working…" : editing ? "Send changes" : "Create picture"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
