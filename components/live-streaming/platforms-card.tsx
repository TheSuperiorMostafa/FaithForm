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
  /** Set when a stored connection went stale and needs re-authorization. */
  needsReconnect?: boolean;
  reconnectReason?: string | null;
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
          RTMP destinations are provisioned when you go live or when a scheduled
          service starts. Channels are connected in Settings → Integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PlatformRow
          icon={<Play className="size-4 text-red-500" />}
          name="YouTube"
          state={youtube}
          isAdmin={isAdmin}
        />
        <PlatformRow
          icon={<Share2 className="size-4 text-blue-500" />}
          name="Facebook"
          state={facebook}
          isAdmin={isAdmin}
        />

        {isAdmin && (
          <Link
            href={SETTINGS_INTEGRATIONS_HREF}
            className="block text-xs font-medium text-accent hover:underline"
          >
            Manage integrations in Settings →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

/** All connect/disconnect flows live on the Settings → Integrations tab. */
const SETTINGS_INTEGRATIONS_HREF = "/dashboard/settings?tab=integrations";

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
  isAdmin,
}: {
  icon: React.ReactNode;
  name: string;
  state: PlatformPushState;
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
            <p className="mt-0.5 text-xs text-muted-foreground">
              {state.needsReconnect
                ? (state.reconnectReason ?? "Reconnect needed")
                : "Not connected"}
            </p>
          )}
        </div>
      </div>

      {isAdmin && !state.connected ? (
        <Link href={SETTINGS_INTEGRATIONS_HREF} className="shrink-0">
          <Button size="sm" variant="outline">
            {state.needsReconnect ? "Reconnect" : "Connect"} in Settings
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
