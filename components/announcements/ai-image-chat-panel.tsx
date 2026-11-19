"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";

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
  IMAGE_CHAT_EVENT_INSTRUCTION,
  MAX_IMAGE_CHAT_HISTORY_TURNS,
  MAX_IMAGE_CHAT_INSTRUCTION_CHARS,
  type ImageChatEventContext,
  type ImageChatMode,
  type ImageChatTurn,
} from "@/lib/ai/image/chat-prompt";
import { describeRequestFailure } from "@/lib/errors/user-error";
import { cn } from "@/lib/utils";

type ChatImage = { mimeType: string; data: string; width: number; height: number };

type ModelMessage = { id: string; role: "model"; text: string | null; image: ChatImage; version: number };
type Message = { id: string; role: "user"; text: string } | ModelMessage;

/** One tap for the changes people ask for most. */
const QUICK_CHANGES = [
  "Make the title bigger",
  "Brighter and warmer",
  "Make the logo bigger",
  "Try a different background",
];

const DESCRIBE_EXAMPLES = [
  "A warm harvest table set for a fall potluck, string lights overhead",
  "A quiet sanctuary at sunrise with light through tall windows",
  "Bold, modern youth night graphic in deep blue and orange",
];

const FAILED = "We couldn't make that picture right now";

/** The event graphic's frame (IMAGE_CHAT_OUTPUT_WIDTH × IMAGE_CHAT_OUTPUT_HEIGHT), spelled out for Tailwind. */
const FRAME = "aspect-[1200/630]";

function toFile(image: ChatImage, version: number): File {
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `ai-picture-${version}.jpg`, { type: image.mimeType });
}

function imageSrc(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function historyFor(messages: Message[]): ImageChatTurn[] {
  return messages
    .map((m): ImageChatTurn =>
      m.role === "user"
        ? { role: "user", text: m.text }
        : { role: "model", text: m.text || `Made version ${m.version}.` },
    )
    .slice(-MAX_IMAGE_CHAT_HISTORY_TURNS);
}

/**
 * The event composer's "Create image for me" studio. Opening it from the
 * composer designs a finished event picture straight away (title, day, place,
 * the church's logo and colours, in the 1200×630 event frame), then asks what
 * to change. Each message edits the version on the canvas; every version stays
 * in the strip, and "Use this picture" attaches it to the event.
 *
 * Big canvas beside the chat on a computer; canvas above the chat on a phone.
 * The conversation is kept only here, in the browser, while the composer is open.
 */
export function AiImageChatPanel({
  open,
  onOpenChange,
  event,
  startRequest,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ImageChatEventContext;
  /** Bumped by the composer to design a fresh picture from the event. */
  startRequest: number;
  /** Attaches the picture. Resolves to an error message, or null when it worked. */
  onUse: (file: File) => Promise<string | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<ImageChatMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ mode: ImageChatMode; text: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledStart = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending, error]);

  const versions = messages.filter((m): m is ModelMessage => m.role === "model");
  const latest = versions[versions.length - 1] ?? null;
  const selected = versions.find((m) => m.id === selectedId) ?? latest;

  const send = useCallback(
    async (mode: ImageChatMode, text: string) => {
      const instruction = mode === "event" ? IMAGE_CHAT_EVENT_INSTRUCTION : text.trim();
      if (!instruction || abortRef.current) return;
      setError(null);
      setRetry(null);
      setSending(mode);

      const base = mode === "describe" ? selected : null;
      const history = historyFor(messages);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: instruction }]);
      if (mode === "describe") setInput("");

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/announcements/image-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode,
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
        // The newest version goes on the canvas; the next message edits it.
        setSelectedId(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && !(err instanceof TypeError || err instanceof SyntaxError) && err.message
            ? err.message
            : describeRequestFailure(FAILED),
        );
        setRetry({ mode, text: instruction });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setSending(null);
      }
    },
    [event, messages, selected],
  );

  // The composer's button: open and start designing at once.
  useEffect(() => {
    if (!open || startRequest === 0 || handledStart.current === startRequest) return;
    handledStart.current = startRequest;
    void send("event", "");
  }, [open, startRequest, send]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send("describe", input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send("describe", input);
    }
  };

  const use = async () => {
    if (!selected) return;
    setError(null);
    setRetry(null);
    setUsing(true);
    try {
      const problem = await onUse(toFile(selected.image, selected.version));
      if (problem) {
        setError(problem);
        return;
      }
      onOpenChange(false);
    } finally {
      setUsing(false);
    }
  };

  const startOver = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(null);
    setMessages([]);
    setSelectedId(null);
    setError(null);
    setRetry(null);
    setInput("");
    inputRef.current?.focus();
  };

  const busy = sending !== null;
  const hasImage = Boolean(selected);
  const canMakeFromEvent = Boolean(event.title);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby="ai-image-studio-title"
        className="m-0 h-dvh max-h-dvh w-full max-w-none overflow-hidden rounded-none border-0 sm:m-auto sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-2xl sm:border lg:h-[min(820px,calc(100dvh-2rem))]"
      >
        <DialogHeader className="pr-16">
          <DialogTitle id="ai-image-studio-title" className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary dark:text-accent" aria-hidden />
            Create image for me
          </DialogTitle>
          <DialogDescription>
            We design it from your event, with your logo and colours. Then tell us what to change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-auto flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] md:grid-rows-[minmax(0,1fr)]">
          {/* Canvas */}
          <section
            aria-label="Picture"
            className="flex shrink-0 flex-col gap-3 border-b border-border bg-muted/40 p-4 md:min-h-0 md:justify-center md:overflow-y-auto md:border-b-0 md:border-r md:p-8"
          >
            <div
              className={cn(
                "relative w-full overflow-hidden rounded-xl border border-border bg-card shadow-card-hover",
                FRAME,
              )}
            >
              {selected ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc(selected.image)}
                  alt={`Version ${selected.version} of your picture`}
                  width={selected.image.width}
                  height={selected.image.height}
                  className={cn(
                    "size-full object-cover transition-[opacity,filter] duration-300 motion-reduce:transition-none",
                    sending === "describe" && "opacity-60 blur-[2px]",
                  )}
                />
              ) : busy ? (
                <SkeletonContainer label="your picture" className="size-full">
                  <Skeleton className="size-full rounded-none bg-primary/[0.07] dark:bg-accent/10" />
                </SkeletonContainer>
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                  <Wand2 className="size-7 text-primary dark:text-accent" aria-hidden />
                  <p className="text-[15px]">Your picture will appear here.</p>
                </div>
              )}
              {busy && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
                  <p className="flex items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-sm font-medium shadow-sm backdrop-blur">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                    {sending === "describe" && hasImage ? "Making your changes…" : "Designing your picture… about 30 seconds"}
                  </p>
                </div>
              )}
            </div>

            {(versions.length > 1 || selected) && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {versions.length > 1 ? (
                  <ol className="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Versions">
                    {versions.map((version) => (
                      <li key={version.id} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedId(version.id)}
                          disabled={busy}
                          aria-pressed={selected?.id === version.id}
                          aria-label={`Show version ${version.version}`}
                          className={cn(
                            "relative block h-11 overflow-hidden rounded-lg border-2 transition-colors disabled:opacity-60",
                            FRAME,
                            selected?.id === version.id
                              ? "border-primary dark:border-accent"
                              : "border-transparent hover:border-border",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageSrc(version.image)} alt="" className="size-full object-cover" />
                          <span className="absolute bottom-0.5 right-1 rounded bg-background/85 px-1 text-xs font-semibold">
                            {version.version}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <span />
                )}
                {selected && (
                  <Button type="button" onClick={() => void use()} disabled={using || busy} className="min-h-11">
                    {using ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                    {using ? "Adding…" : "Use this picture"}
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* Chat */}
          <section aria-label="Changes" className="flex min-h-0 flex-auto flex-col">
            <div ref={threadRef} className="min-h-0 flex-auto overflow-y-auto px-5 py-5" aria-live="polite">
              {messages.length === 0 && !busy ? (
                <div className="flex flex-col gap-3">
                  {canMakeFromEvent && (
                    <Button
                      type="button"
                      className="min-h-11 justify-start"
                      onClick={() => void send("event", "")}
                    >
                      <Sparkles aria-hidden />
                      Design it from my event
                    </Button>
                  )}
                  <p className="text-[15px] text-muted-foreground">
                    {canMakeFromEvent ? "Or describe your own:" : "Describe your picture, or try one of these:"}
                  </p>
                  {DESCRIBE_EXAMPLES.map((example) => (
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
                </div>
              ) : (
                <ol className="flex flex-col gap-3">
                  {messages.map((message) =>
                    message.role === "user" ? (
                      <li key={message.id} className="flex justify-end">
                        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
                          {message.text}
                        </p>
                      </li>
                    ) : (
                      <li key={message.id} className="flex max-w-[92%] gap-2.5">
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent">
                          <Sparkles className="size-3.5" aria-hidden />
                        </span>
                        <div className="flex flex-col gap-1 rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-[15px]">
                          <span className="font-semibold">Version {message.version} is ready.</span>
                          {message.text && <span className="text-muted-foreground">{message.text}</span>}
                          {message.id === latest?.id && !busy && (
                            <span>
                              Want any changes? Tell me what to change, or press{" "}
                              <span className="font-semibold">Use this picture</span>.
                            </span>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                  {busy && (
                    <li className="flex gap-2.5" aria-hidden>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent">
                        <Sparkles className="size-3.5" />
                      </span>
                      <span className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-muted px-4 py-3">
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                    </li>
                  )}
                </ol>
              )}
              {error && (
                <div role="alert" className="mt-4 flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <p className="text-[15px] text-destructive">{error}</p>
                  {retry && !busy && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 self-start"
                      onClick={() => {
                        // Drop the unanswered message so the thread doesn't repeat it.
                        setMessages((prev) =>
                          prev[prev.length - 1]?.role === "user" ? prev.slice(0, -1) : prev,
                        );
                        void send(retry.mode, retry.text);
                      }}
                    >
                      <RotateCcw aria-hidden />
                      Try again
                    </Button>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={onSubmit} className="flex shrink-0 flex-col gap-3 border-t border-border px-5 py-4">
              {hasImage && !busy && (
                <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden" aria-label="Quick changes">
                  {QUICK_CHANGES.map((change) => (
                    <Button
                      key={change}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 rounded-full font-normal"
                      onClick={() => void send("describe", change)}
                    >
                      {change}
                    </Button>
                  ))}
                </div>
              )}
              <label htmlFor="ai-image-studio-input" className="sr-only">
                {hasImage ? "What should change?" : "Describe your picture"}
              </label>
              <Textarea
                id="ai-image-studio-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={MAX_IMAGE_CHAT_INSTRUCTION_CHARS}
                rows={2}
                className="min-h-[76px] resize-none rounded-2xl"
                placeholder={
                  hasImage
                    ? "What should change? e.g. use navy and gold, add “Free meal”"
                    : "Describe your picture"
                }
                disabled={busy}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {messages.length > 0 ? (
                  <Button type="button" variant="ghost" className="min-h-11" onClick={startOver} disabled={using}>
                    <RotateCcw aria-hidden />
                    Start over
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" className="min-h-11 rounded-full px-5" disabled={busy || !input.trim()}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
                  {busy ? "Working…" : hasImage ? "Send changes" : "Create picture"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
