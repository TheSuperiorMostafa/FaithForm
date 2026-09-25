"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Laptop, Loader2, RefreshCw } from "lucide-react";
import { createStreamingPcPairingCode } from "@/app/dashboard/live-streaming/actions";
import { Button } from "@/components/ui/button";
import type { EncoderDevice } from "@/lib/stream/encoder";

type EncoderPairingCardProps = {
  isAdmin: boolean;
  devices: EncoderDevice[];
};

/**
 * Pairing a streaming PC with FaithForm's helper program, so Go live can start
 * OBS for you. Rare and technical, so it lives under Setup › Advanced.
 */
export function EncoderPairingCard({ isAdmin, devices }: EncoderPairingCardProps) {
  const [pending, startTransition] = useTransition();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const pairedDevice = devices.find((device) => device.isPaired);

  const createCode = () => {
    startTransition(async () => {
      const result = await createStreamingPcPairingCode();
      if (!result.ok || !result.pairingCode) {
        toast.error(result.error ?? "We couldn't create a pairing code. Please try again.");
        return;
      }
      setPairingCode(result.pairingCode);
      setExpiresAt(result.expiresAt ?? null);
      toast.success("Pairing code created. Enter it on your streaming PC.");
    });
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Laptop className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-lg font-semibold">Pair a streaming PC</h3>
          <p className="text-[15px] text-muted-foreground">
            Pair the computer running OBS so FaithForm can start streams for you.
          </p>
        </div>
      </div>

      {pairedDevice ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[15px]">
          <p className="font-medium">{pairedDevice.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Paired {pairedDevice.pairedAt ? new Date(pairedDevice.pairedAt).toLocaleString() : ""}
            {pairedDevice.lastSeenAt
              ? ` · Last seen ${new Date(pairedDevice.lastSeenAt).toLocaleString()}`
              : " · The helper program isn't running"}
          </p>
        </div>
      ) : (
        <p className="text-[15px] text-muted-foreground">No streaming PC paired yet.</p>
      )}

      {pairingCode ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-semibold text-muted-foreground">Pairing code</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em]">{pairingCode}</p>
          {expiresAt ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Expires {new Date(expiresAt).toLocaleTimeString()}
            </p>
          ) : null}
          <p className="mt-4 text-sm text-muted-foreground">On the streaming PC, run:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 text-sm text-muted-foreground">
{`cd infra/stream-agent
npm install
FAITHFORM_PAIRING_CODE=${pairingCode} npm start`}
          </pre>
        </div>
      ) : null}

      <Button type="button" variant="outline" className="w-fit gap-2" disabled={pending} onClick={createCode}>
        {pending ? (
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        {pairingCode ? "Create a new pairing code" : "Pair streaming PC"}
      </Button>
    </div>
  );
}
