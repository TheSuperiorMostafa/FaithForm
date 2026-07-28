"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Play,
  RadioTower,
  Share2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SyndicationStatus } from "@/lib/stream/syndication";

export type PlatformPushState = {
  connected: boolean;
  detail: string | null;
  /** True once an RTMP destination is provisioned for the current service. */
  destinationReady: boolean;
  lastPush: SyndicationStatus | null;
};

type PlatformsCardProps = {
  isAdmin: boolean;
  youtube: PlatformPushState;
  facebook: PlatformPushState;
};

export function PlatformsCard({
  isAdmin,
  youtube,
  facebook,
}: PlatformsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Where to broadcast</CardTitle>
        <CardDescription>
          Connect channels for syndication. RTMP destinations are provisioned when
          you go live or when a scheduled service starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PlatformRow
          icon={<Play className="size-4 text-red-500" />}
          name="YouTube"
          state={youtube}
          connectHref="/api/integrations/youtube/connect?return_to=/dashboard/live-streaming"
          connectLabel="Connect YouTube"
          isAdmin={isAdmin}
        />
        <PlatformRow
          icon={<Share2 className="size-4 text-blue-500" />}
          name="Facebook"
          state={facebook}
          connectHref="/api/integrations/facebook/connect?return_to=/dashboard/live-streaming"
          connectLabel="Connect Facebook"
          isAdmin={isAdmin}
        />
      </CardContent>
    </Card>
  );
}

function PushStatus({ state }: { state: PlatformPushState }) {
  if (state.lastPush?.status === "failed") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        <TriangleAlert
          className="mt-0.5 size-3.5 shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
        <span>
          Last push failed
          {state.lastPush.errorMessage
            ? `: ${state.lastPush.errorMessage}`
            : "."}
        </span>
      </p>
    );
  }

  if (state.destinationReady) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <RadioTower className="size-3.5" strokeWidth={1.75} aria-hidden />
        Push destination ready
      </p>
    );
  }

  if (state.lastPush?.status === "success") {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        Last service pushed successfully.
      </p>
    );
  }

  return null;
}

function PlatformRow({
  icon,
  name,
  state,
  connectHref,
  connectLabel,
  isAdmin,
}: {
  icon: React.ReactNode;
  name: string;
  state: PlatformPushState;
  connectHref: string;
  connectLabel: string;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{name}</p>
          {state.connected ? (
            <>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                {state.detail ?? "Connected"} · Ready to stream
              </p>
              <PushStatus state={state} />
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Not connected</p>
          )}
        </div>
      </div>

      {isAdmin && !state.connected ? (
        <Link href={connectHref} className="shrink-0">
          <Button size="sm" variant="outline">
            {connectLabel}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
