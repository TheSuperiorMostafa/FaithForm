"use client";

import Link from "next/link";
import { CheckCircle2, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PlatformsCardProps = {
  isAdmin: boolean;
  youtubeConnected: boolean;
  youtubeChannelTitle: string | null;
  facebookConnected: boolean;
  facebookPageName: string | null;
};

export function PlatformsCard({
  isAdmin,
  youtubeConnected,
  youtubeChannelTitle,
  facebookConnected,
  facebookPageName,
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
          connected={youtubeConnected}
          detail={youtubeChannelTitle}
          connectHref="/api/integrations/youtube/connect?return_to=/dashboard/live-streaming"
          connectLabel="Connect YouTube"
          isAdmin={isAdmin}
        />
        <PlatformRow
          icon={<Share2 className="size-4 text-blue-500" />}
          name="Facebook"
          connected={facebookConnected}
          detail={facebookPageName}
          connectHref="/api/integrations/facebook/connect?return_to=/dashboard/live-streaming"
          connectLabel="Connect Facebook"
          isAdmin={isAdmin}
        />
      </CardContent>
    </Card>
  );
}

function PlatformRow({
  icon,
  name,
  connected,
  detail,
  connectHref,
  connectLabel,
  isAdmin,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  detail: string | null;
  connectHref: string;
  connectLabel: string;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <p className="text-sm font-semibold">{name}</p>
          {connected ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              {detail ?? "Connected"} · Ready to stream
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Not connected</p>
          )}
        </div>
      </div>

      {isAdmin && !connected ? (
        <Link href={connectHref} className="shrink-0">
          <Button size="sm" variant="outline">
            {connectLabel}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
