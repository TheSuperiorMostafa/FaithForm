"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Server } from "lucide-react";
import { toast } from "sonner";
import { revealIngestKey } from "@/app/dashboard/live-streaming/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EncoderSetupCardProps = {
  ingestServerUrl: string;
  isAdmin: boolean;
};

export function EncoderSetupCard({
  ingestServerUrl,
  isAdmin,
}: EncoderSetupCardProps) {
  const [copied, setCopied] = useState<"server" | "key" | null>(null);
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState<{ value: string; expiresAt: string } | null>(
    null,
  );

  const copy = async (field: "server" | "key", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleReveal = () => {
    startTransition(async () => {
      const result = await revealIngestKey();
      if (!result.ok || !result.ingestKey || !result.expiresAt) {
        toast.error(result.error ?? "Could not create a stream key.");
        return;
      }
      setKey({ value: result.ingestKey, expiresAt: result.expiresAt });
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-accent" aria-hidden />
          Encoder settings
        </CardTitle>
        <CardDescription>
          Point OBS, vMix, or a hardware encoder at this server. Pair the
          streaming PC below and FaithForm hands it the key on its own; running
          the encoder by hand, get a key here on the day you stream.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="encoder-server">Server URL</Label>
          <div className="flex gap-2">
            <Input
              id="encoder-server"
              value={ingestServerUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => void copy("server", ingestServerUrl)}
              aria-label="Copy server URL"
            >
              {copied === "server" ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="encoder-key">Stream key</Label>
          {key ? (
            <>
              <div className="flex gap-2">
                <Input
                  id="encoder-key"
                  value={key.value}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void copy("key", key.value)}
                  aria-label="Copy stream key"
                >
                  {copied === "key" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste the whole thing into the encoder&rsquo;s Stream Key field.
                It works until{" "}
                <strong className="font-medium text-foreground">
                  {new Date(key.expiresAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </strong>{" "}
                today; after that, come back for a fresh one.
              </p>
            </>
          ) : isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={handleReveal}
              >
                <KeyRound className="mr-1.5 size-3.5" aria-hidden />
                {pending ? "Creating…" : "Show stream key"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Lasts 4 hours. Create it on the day you stream.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A church admin can create a stream key here.
            </p>
          )}
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          Every key expires on its own and only works for this church. A paired
          streaming PC gets one automatically when it starts a broadcast and
          loses it when the broadcast stops.
        </p>
      </CardContent>
    </Card>
  );
}
