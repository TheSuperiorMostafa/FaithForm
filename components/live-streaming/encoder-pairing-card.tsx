"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Laptop, RefreshCw } from "lucide-react";
import { createStreamingPcPairingCode } from "@/app/dashboard/live-streaming/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EncoderDevice } from "@/lib/stream/encoder";

type EncoderPairingCardProps = {
  isAdmin: boolean;
  devices: EncoderDevice[];
};

export function EncoderPairingCard({ isAdmin, devices }: EncoderPairingCardProps) {
  const [pending, startTransition] = useTransition();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const pairedDevice = devices.find((device) => device.isPaired);

  const createCode = () => {
    startTransition(async () => {
      const result = await createStreamingPcPairingCode();
      if (!result.ok || !result.pairingCode) {
        toast.error(result.error ?? "Could not create pairing code.");
        return;
      }
      setPairingCode(result.pairingCode);
      setExpiresAt(result.expiresAt ?? null);
      toast.success("Pairing code created.");
    });
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Laptop className="size-4 text-accent" aria-hidden />
          Streaming PC
        </CardTitle>
        <CardDescription>
          Pair the computer running OBS so FaithForm can start streams for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pairedDevice ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-medium">{pairedDevice.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paired {pairedDevice.pairedAt ? new Date(pairedDevice.pairedAt).toLocaleString() : ""}
              {pairedDevice.lastSeenAt
                ? ` · Last seen ${new Date(pairedDevice.lastSeenAt).toLocaleString()}`
                : " · Agent not running"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No streaming PC paired yet.
          </p>
        )}

        {pairingCode ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pairing code
            </p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em]">
              {pairingCode}
            </p>
            {expiresAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Expires {new Date(expiresAt).toLocaleTimeString()}
              </p>
            ) : null}
            <pre className="mt-4 overflow-x-auto rounded-lg bg-background p-3 text-xs text-muted-foreground">
{`cd infra/stream-agent
npm install
FAITHFORM_PAIRING_CODE=${pairingCode} npm start`}
            </pre>
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={pending}
          onClick={createCode}
        >
          <RefreshCw className="size-4" />
          {pairingCode ? "New pairing code" : "Pair streaming PC"}
        </Button>
      </CardContent>
    </Card>
  );
}
