"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Server } from "lucide-react";
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
};

export function EncoderSetupCard({
  ingestServerUrl,
}: EncoderSetupCardProps) {
  const [copied, setCopied] = useState<"server" | null>(null);

  const copy = async (field: "server", value: string) => {
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
          Pair the streaming PC below. FaithForm delivers the ingest credential
          directly to the trusted encoder agent; it is never shown in a browser.
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

        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          A short-lived ingest capability is delivered only when the paired
          encoder starts a broadcast, then cleared when it stops.
        </p>
      </CardContent>
    </Card>
  );
}
