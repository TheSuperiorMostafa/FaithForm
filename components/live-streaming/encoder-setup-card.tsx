"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, RotateCcw, Server } from "lucide-react";
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
  isAdmin: boolean;
  streamName: string;
  ingestServerUrl: string;
  pending: boolean;
  onRotateKey: () => void;
};

export function EncoderSetupCard({
  isAdmin,
  streamName,
  ingestServerUrl,
  pending,
  onRotateKey,
}: EncoderSetupCardProps) {
  const [copied, setCopied] = useState<"server" | "key" | null>(null);

  const copy = async (field: "server" | "key", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-accent" aria-hidden />
          Encoder settings
        </CardTitle>
        <CardDescription>
          Paste these into ATEM Mini Pro, OBS, or any RTMP encoder.
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
          <Label htmlFor="encoder-key" className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-muted-foreground" />
            Stream key
          </Label>
          <div className="flex gap-2">
            <Input
              id="encoder-key"
              value={streamName}
              readOnly
              placeholder="Generating…"
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={!streamName}
              onClick={() => void copy("key", streamName)}
              aria-label="Copy stream key"
            >
              {copied === "key" ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </div>

        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={pending || !streamName}
            onClick={onRotateKey}
          >
            <RotateCcw className="size-4" />
            Regenerate key
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
