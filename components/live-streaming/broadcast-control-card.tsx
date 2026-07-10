"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Radio, Square } from "lucide-react";
import {
  endLiveBroadcastAction,
  goLiveBroadcast,
} from "@/app/dashboard/live-streaming/actions";
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
import type { StreamSession } from "@/lib/stream/sessions";
import { cn } from "@/lib/utils";

type BroadcastControlCardProps = {
  isAdmin: boolean;
  initialSession: StreamSession | null;
  encoderPaired: boolean;
  canGoLive: boolean;
};

type StatusResponse = {
  session: StreamSession | null;
  encoder: { isPaired: boolean; lastSeenAt: string | null; label: string } | null;
};

export function BroadcastControlCard({
  isAdmin,
  initialSession,
  encoderPaired,
  canGoLive,
}: BroadcastControlCardProps) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [session, setSession] = useState(initialSession);
  const [encoderOnline, setEncoderOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/stream/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setSession(data.session);
        setEncoderOnline(
          Boolean(
            data.encoder?.lastSeenAt &&
              Date.now() - new Date(data.encoder.lastSeenAt).getTime() < 45_000,
          ),
        );
      } catch {
        // Ignore transient polling errors.
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const isLive = session?.status === "live";
  const isStarting =
    session?.status === "preparing" || session?.status === "waiting_for_encoder";

  const handleGoLive = () => {
    startTransition(async () => {
      const result = await goLiveBroadcast(title.trim() || undefined);
      if (!result.ok) {
        toast.error(result.error ?? "Could not go live.");
        return;
      }
      toast.success("Going live…");
    });
  };

  const handleEndLive = () => {
    startTransition(async () => {
      const result = await endLiveBroadcastAction();
      if (!result.ok) {
        toast.error(result.error ?? "Could not end broadcast.");
        return;
      }
      toast.success("Broadcast ended.");
    });
  };

  return (
    <Card className="overflow-hidden border-sidebar-accent/30">
      <CardHeader className="border-b border-border/60 bg-muted/20">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="size-4 text-accent" aria-hidden />
          Broadcast control
        </CardTitle>
        <CardDescription>
          One button to provision platforms and start your encoder.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-4">
          <span
            className={cn(
              "size-3 rounded-full",
              isLive
                ? "animate-pulse bg-emerald-500"
                : isStarting
                  ? "animate-pulse bg-amber-400"
                  : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold">
              {isLive
                ? "Live now"
                : isStarting
                  ? "Starting broadcast…"
                  : "Offline"}
            </p>
            <p className="text-xs text-muted-foreground">
              {encoderPaired
                ? encoderOnline
                  ? "Streaming PC connected"
                  : "Streaming PC not detected — start the FaithForm agent"
                : "Pair your streaming PC to enable one-click Go Live"}
            </p>
          </div>
        </div>

        {isAdmin ? (
          <>
            {!isLive && !isStarting ? (
              <div className="space-y-2">
                <Label htmlFor="broadcast-title">Service title (optional)</Label>
                <Input
                  id="broadcast-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Sunday Morning Worship"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {!isLive && !isStarting ? (
                <Button
                  onClick={handleGoLive}
                  disabled={pending || !canGoLive}
                  className="gap-2"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Radio className="size-4" />
                  )}
                  Go Live
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleEndLive}
                  disabled={pending}
                  className="gap-2"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Square className="size-4" />
                  )}
                  End stream
                </Button>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
