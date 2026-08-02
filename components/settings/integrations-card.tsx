"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  Calendar,
  Mail,
  Play,
  RadioTower,
  Share2,
} from "lucide-react";
import { disconnectIntegrationAction } from "@/app/dashboard/settings/integration-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { IntegrationStatus } from "@/lib/integrations/tokens";

export type IntegrationsCardProps = {
  isAdmin: boolean;
  status: IntegrationStatus;
};

type Provider = "google" | "facebook" | "youtube";

const CONNECT_SUCCESS: Record<string, string> = {
  google_connected: "Google Calendar and Gmail connected.",
  facebook_connected: "Facebook Page connected.",
  youtube_connected: "YouTube channel connected.",
};

export function IntegrationsCard({ isAdmin, status }: IntegrationsCardProps) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hit = Object.keys(CONNECT_SUCCESS).find((key) =>
      searchParams.get(key),
    );
    if (hit) {
      setMessage(CONNECT_SUCCESS[hit]);
      setError(null);
      return;
    }
    const failure = searchParams.get("integration_error");
    if (failure) {
      setError(failure);
      setMessage(null);
    }
  }, [searchParams]);

  const handleDisconnect = (provider: Provider, label: string) => {
    if (!confirm(`Disconnect ${label}?`)) return;
    startTransition(async () => {
      const result = await disconnectIntegrationAction(provider);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setMessage(`${label} disconnected.`);
      window.location.href = "/dashboard/settings?tab=integrations";
    });
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Only church admins can connect Google Calendar, Gmail, Facebook, and
            YouTube.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // `return_to` brings the admin back to this tab after the OAuth round trip.
  const returnTo = encodeURIComponent("/dashboard/settings?tab=integrations");

  return (
    <div className="flex flex-col gap-4">
      {(message || error) && (
        <p
          className={
            error
              ? "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              : "rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
          }
          role="status"
        >
          {error ?? message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Calendar & email</CardTitle>
          <CardDescription>
            Prefill announcements from Google Calendar and draft weekly emails
            in Gmail. One Google connection covers both.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <IntegrationRow
            icon={<Calendar className="size-5 text-accent" strokeWidth={1.75} />}
            name="Google Calendar"
            connected={status.google.connected}
            needsReconnect={status.google.needsReconnect}
            reconnectReason={status.google.reconnectReason}
            detail={
              status.google.connected
                ? `${status.google.email ?? "Connected"} · calendar: ${status.google.calendarId}`
                : "Not connected"
            }
            connectHref={`/api/integrations/google/connect?return_to=${returnTo}`}
            onDisconnect={() => handleDisconnect("google", "Google")}
            disconnectDisabled={pending}
          />

          <IntegrationRow
            icon={<Mail className="size-5 text-accent" strokeWidth={1.75} />}
            name="Gmail"
            connected={status.google.connected}
            needsReconnect={status.google.needsReconnect}
            reconnectReason={status.google.reconnectReason}
            detail={
              status.google.connected
                ? `Drafts sent from ${status.google.email ?? "your Google account"}`
                : "Connect Google to enable Gmail drafts"
            }
            connectHref={`/api/integrations/google/connect?return_to=${returnTo}`}
            onDisconnect={() => handleDisconnect("google", "Google")}
            disconnectDisabled={pending}
            sharesConnectionWith="Google Calendar"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Streaming & social</CardTitle>
          <CardDescription>
            Where services broadcast and announcements post. RTMP destinations
            are provisioned automatically when a service goes live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <IntegrationRow
            icon={<Play className="size-5 text-red-500" strokeWidth={1.75} />}
            name="YouTube"
            connected={status.youtube.connected}
            needsReconnect={status.youtube.needsReconnect}
            reconnectReason={status.youtube.reconnectReason}
            detail={
              status.youtube.connected
                ? (status.youtube.channelTitle ??
                  status.youtube.channelId ??
                  "Connected")
                : "Not connected"
            }
            connectHref={`/api/integrations/youtube/connect?return_to=${returnTo}`}
            onDisconnect={() => handleDisconnect("youtube", "YouTube")}
            disconnectDisabled={pending}
          />

          <IntegrationRow
            icon={<Share2 className="size-5 text-blue-500" strokeWidth={1.75} />}
            name="Facebook Page"
            connected={status.facebook.connected}
            needsReconnect={status.facebook.needsReconnect}
            reconnectReason={status.facebook.reconnectReason}
            detail={
              status.facebook.connected
                ? (status.facebook.pageName ??
                  status.facebook.pageId ??
                  "Connected")
                : "Not connected"
            }
            connectHref={`/api/integrations/facebook/connect?return_to=${returnTo}`}
            onDisconnect={() => handleDisconnect("facebook", "Facebook")}
            disconnectDisabled={pending}
          />

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/45 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <RadioTower className="size-5" strokeWidth={1.75} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Stream relay</p>
                  <Badge
                    variant={status.stream.connected ? "default" : "secondary"}
                  >
                    {status.stream.connected ? "Ready" : "Not set up"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {status.stream.relayHost
                    ? `Relay host: ${status.stream.relayHost}`
                    : "Set up when you first go live"}
                </p>
              </div>
            </div>
            <Link href="/dashboard/live-streaming" className="shrink-0">
              <Button size="sm" variant="outline">
                Open Live Streaming
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationRow({
  icon,
  name,
  connected,
  needsReconnect,
  reconnectReason,
  detail,
  connectHref,
  onDisconnect,
  disconnectDisabled,
  sharesConnectionWith,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  needsReconnect?: boolean;
  reconnectReason?: string | null;
  detail: string;
  connectHref: string;
  onDisconnect: () => void;
  disconnectDisabled: boolean;
  /** Set when this row is powered by another row's OAuth connection. */
  sharesConnectionWith?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/45 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {icon}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{name}</p>
            <Badge
              variant={
                connected
                  ? "default"
                  : needsReconnect
                    ? "destructive"
                    : "secondary"
              }
            >
              {connected
                ? "Connected"
                : needsReconnect
                  ? "Reconnect needed"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{detail}</p>
          {sharesConnectionWith && (
            <p className="text-xs text-muted-foreground">
              Uses the same connection as {sharesConnectionWith}.
            </p>
          )}
          {!connected && needsReconnect && reconnectReason && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>{reconnectReason}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnectDisabled}
          >
            Disconnect
          </Button>
        ) : (
          <Link href={connectHref}>
            <Button size="sm">
              {needsReconnect ? "Reconnect" : "Connect"}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
