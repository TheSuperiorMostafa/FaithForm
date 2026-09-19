"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CheckCircle2, CircleDashed, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";

import { revealIngestKey } from "@/app/dashboard/live-streaming/actions";
import { rotateStreamKeyAction } from "@/app/dashboard/live-streaming/recording-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EncoderSetupCardProps = {
  ingestServerUrl: string;
  isAdmin: boolean;
};

/** A revealed key hides itself again, so it never sits on a screen all service. */
const KEY_VISIBLE_MS = 60_000;

/**
 * Connect your streaming software — done once, then left alone.
 *
 * The stream key is a credential: it is fetched only when an admin asks (as a
 * server action reply, never in page props), shown for a minute, and can be
 * replaced if it may have leaked.
 */
export function EncoderSetupCard({ ingestServerUrl, isAdmin }: EncoderSetupCardProps) {
  const [copied, setCopied] = useState<"server" | "key" | null>(null);
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<"unknown" | "receiving" | "not_receiving">("unknown");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const copy = async (field: "server" | "key", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleReveal = () => {
    startTransition(async () => {
      const result = await revealIngestKey();
      if (!result.ok || !result.ingestKey) {
        toast.error(result.error ?? "Could not load the stream key.");
        return;
      }
      setKey(result.ingestKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setKey(null), KEY_VISIBLE_MS);
    });
  };

  const testConnection = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/stream/status", { cache: "no-store" });
      const data = (await res.json()) as { overview?: { video?: { arriving?: boolean } } };
      setConnection(data.overview?.video?.arriving ? "receiving" : "not_receiving");
    } catch {
      toast.error("Couldn't check right now. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  };

  const replaceKey = () =>
    startTransition(async () => {
      const result = await rotateStreamKeyAction();
      setConfirmReplace(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setKey(null);
      toast.success("New stream key created. Show it and paste it into your streaming software.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-accent" aria-hidden />
          Connect your streaming software
        </CardTitle>
        <CardDescription>
          FaithForm works with OBS, vMix, ATEM Mini and hardware encoders. Copy these two values into your
          software&rsquo;s stream settings once — then you won&rsquo;t need this page again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="encoder-server">Server URL</Label>
          <div className="flex gap-2">
            <Input id="encoder-server" value={ingestServerUrl} readOnly className="font-mono text-sm" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => void copy("server", ingestServerUrl)}
              aria-label="Copy server URL"
            >
              {copied === "server" ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="encoder-key">Stream key</Label>
          {key ? (
            <>
              <div className="flex gap-2">
                <Input id="encoder-key" value={key} readOnly className="font-mono text-sm" autoComplete="off" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void copy("key", key)}
                  aria-label="Copy stream key"
                >
                  {copied === "key" ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setKey(null)}
                  aria-label="Hide stream key"
                >
                  <EyeOff className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste the whole thing into your software&rsquo;s Stream Key field. This key does not expire; it
                hides itself again in a minute.
              </p>
            </>
          ) : isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleReveal}>
                <Eye className="mr-1.5 size-3.5" aria-hidden />
                {pending ? "Loading…" : "Show stream key"}
              </Button>
              <p className="text-xs text-muted-foreground">The same key every time, until you replace it.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A church admin can show the stream key here.</p>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm" role="status" aria-live="polite">
            {connection === "receiving" ? (
              <>
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <span className="font-semibold">Connected.</span> FaithForm is receiving your video.
                </span>
              </>
            ) : connection === "not_receiving" ? (
              <>
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                <span>
                  <span className="font-semibold">Not receiving video yet.</span> Start streaming in your software,
                  then test again.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Start streaming in your software, then test the connection.</span>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void testConnection()} disabled={checking}>
            {checking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : null}
            Test connection
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            Keep this key private — anyone who has it can stream to your church. A paired streaming PC uses the
            same key.
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setConfirmReplace(true)}
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Replace stream key…
            </button>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={confirmReplace} onOpenChange={(open) => !pending && setConfirmReplace(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your stream key?</DialogTitle>
            <DialogDescription>
              The current key stops working right away. You&rsquo;ll need to paste the new key into every streaming
              computer and encoder before your next service. Only do this if the key may have been shared.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReplace(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={replaceKey} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : null}
              Replace key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
