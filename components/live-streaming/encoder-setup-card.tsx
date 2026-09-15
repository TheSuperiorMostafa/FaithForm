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
  const [key, setKey] = useState<string | null>(null);

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
          Point OBS, vMix, or a hardware encoder at this server. Your stream key
          stays the same — paste it once and leave it in the encoder.
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
                  value={key}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void copy("key", key)}
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
                This key does not expire and does not change.
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
                {pending ? "Loading…" : "Show stream key"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Permanent for this church. Same key every time you open it.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A church admin can show the stream key here.
            </p>
          )}
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          Keep this key private. It only works for this church. A paired
          streaming PC uses the same permanent key when it starts a broadcast.
        </p>
      </CardContent>
    </Card>
  );
}
