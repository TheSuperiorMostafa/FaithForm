"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, ClipboardCopy, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { revealIngestKey } from "@/app/dashboard/live-streaming/actions";
import { rotateStreamKeyAction } from "@/app/dashboard/live-streaming/recording-actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A revealed key hides itself again, so it never sits on a screen all service. */
const KEY_VISIBLE_MS = 60_000;

export type StreamKeyState = {
  key: string | null;
  pending: boolean;
  /** Fetches the key (admin only, audited, rate limited) and shows it for a minute. */
  reveal: () => Promise<string | null>;
  hide: () => void;
};

/**
 * The church's stream key, fetched only when an admin asks — as a server
 * action reply, never in page props — shown for a minute, then hidden again.
 * Shared by "Copy both" and the Technical details fields so one reveal serves
 * both.
 */
export function useStreamKey(): StreamKeyState {
  const [key, setKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setKey(null);
  }, []);

  const reveal = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        startTransition(async () => {
          const result = await revealIngestKey();
          if (!result.ok || !result.ingestKey) {
            toast.error(result.error ?? "We couldn't show the stream key. Please try again.");
            resolve(null);
            return;
          }
          setKey(result.ingestKey);
          if (hideTimer.current) clearTimeout(hideTimer.current);
          hideTimer.current = setTimeout(() => setKey(null), KEY_VISIBLE_MS);
          resolve(result.ingestKey);
        });
      }),
    [],
  );

  return { key, pending, reveal, hide };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one button most churches need: the server address and the stream key,
 * together, ready to paste into OBS, an ATEM or vMix (or to send to the
 * person who sets it up).
 */
export function CopyBothButton({
  ingestServerUrl,
  streamKey,
  isAdmin,
}: {
  ingestServerUrl: string;
  streamKey: StreamKeyState;
  isAdmin: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!isAdmin) {
    return <p className="text-[15px] text-muted-foreground">A church admin can copy the server and stream key.</p>;
  }

  const copyBoth = async () => {
    const key = streamKey.key ?? (await streamKey.reveal());
    if (!key) return;
    const ok = await writeClipboard(`Server: ${ingestServerUrl}\nStream key: ${key}`);
    if (!ok) {
      toast.error("Your browser didn't allow copying. Open Technical details below and copy each one.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast.success("Server and stream key copied. Paste each one into its own box in your streaming software.");
  };

  return (
    <Button size="lg" onClick={() => void copyBoth()} disabled={streamKey.pending} className="w-fit gap-2">
      {streamKey.pending ? (
        <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
      ) : copied ? (
        <Check className="size-5" aria-hidden />
      ) : (
        <ClipboardCopy className="size-5" aria-hidden />
      )}
      {copied ? "Copied" : "Copy both"}
    </Button>
  );
}

/**
 * Server address and stream key, one field at a time, plus Replace stream
 * key. Only shown inside "Technical details": most churches use Copy both.
 */
export function StreamTechnicalDetails({
  ingestServerUrl,
  isAdmin,
  streamKey,
}: {
  ingestServerUrl: string;
  isAdmin: boolean;
  streamKey: StreamKeyState;
}) {
  const [copied, setCopied] = useState<"server" | "key" | null>(null);
  const [replacing, startReplace] = useTransition();

  const copy = async (field: "server" | "key", value: string) => {
    if (!(await writeClipboard(value))) {
      toast.error("Your browser didn't allow copying. Select the text and copy it instead.");
      return;
    }
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
    toast.success(field === "server" ? "Server address copied." : "Stream key copied.");
  };

  const replaceKey = async () => {
    const ok = await confirmAction({
      title: "Replace your stream key?",
      description:
        "The current key stops working right away. You'll need to paste the new key into every streaming computer and encoder before your next service. Only do this if the key may have been shared.",
      confirmLabel: "Replace stream key",
      cancelLabel: "Keep current key",
      destructive: true,
    });
    if (!ok) return;
    startReplace(async () => {
      const result = await rotateStreamKeyAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      streamKey.hide();
      toast.success("New stream key created. Show it and paste it into your streaming software.");
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="encoder-server" className="text-[15px]">
          Server (also called URL or Server URL)
        </Label>
        <div className="flex gap-2">
          <Input id="encoder-server" value={ingestServerUrl} readOnly className="font-mono text-[15px]" />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2"
            onClick={() => void copy("server", ingestServerUrl)}
          >
            {copied === "server" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            Copy
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="encoder-key" className="text-[15px]">
          Stream key
        </Label>
        {streamKey.key ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Input
                id="encoder-key"
                value={streamKey.key}
                readOnly
                className="min-w-0 flex-1 font-mono text-[15px]"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-2"
                onClick={() => void copy("key", streamKey.key ?? "")}
              >
                {copied === "key" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                Copy
              </Button>
              <Button type="button" variant="ghost" className="shrink-0 gap-2" onClick={streamKey.hide}>
                <EyeOff className="size-4" aria-hidden />
                Hide
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Paste the whole thing into your software&rsquo;s Stream Key box. This key does not expire; it hides
              itself again in a minute.
            </p>
          </>
        ) : isAdmin ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={streamKey.pending}
              onClick={() => void streamKey.reveal()}
              className="gap-2"
            >
              {streamKey.pending ? (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              Show stream key
            </Button>
            <p className="text-sm text-muted-foreground">The same key every time, until you replace it.</p>
          </div>
        ) : (
          <p className="text-[15px] text-muted-foreground">A church admin can show the stream key here.</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-muted p-4 text-[15px] text-muted-foreground">
        <p className="flex items-start gap-2">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          Keep this key private — anyone who has it can stream to your church. A paired streaming PC uses the same
          key.
        </p>
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void replaceKey()}
            disabled={replacing}
            className="w-fit gap-2"
          >
            {replacing ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Replace stream key…
          </Button>
        ) : null}
      </div>
    </div>
  );
}
