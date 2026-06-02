"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Calendar, Share2 } from "lucide-react";
import { disconnectIntegration } from "@/app/dashboard/announcements/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type IntegrationsCardProps = {
  isAdmin: boolean;
  status: {
    google: {
      connected: boolean;
      email: string | null;
      calendarId: string;
    };
    facebook: {
      connected: boolean;
      pageName: string | null;
      pageId: string | null;
    };
  };
};

export function IntegrationsCard({ isAdmin, status }: IntegrationsCardProps) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("google_connected")) {
      setMessage("Google Calendar and Gmail connected.");
    } else if (searchParams.get("facebook_connected")) {
      setMessage("Facebook Page connected.");
    } else if (searchParams.get("integration_error")) {
      setMessage(searchParams.get("integration_error"));
    }
  }, [searchParams]);

  const handleDisconnect = (provider: "google" | "facebook") => {
    if (!confirm(`Disconnect ${provider}?`)) return;
    startTransition(async () => {
      await disconnectIntegration(provider);
      setMessage(`${provider} disconnected.`);
      window.location.href = "/dashboard/settings";
    });
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Only church admins can connect Google Calendar, Gmail, and Facebook.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect once to prefill announcements from Google Calendar, post to
          Facebook, and draft emails in Gmail.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {message && (
          <p
            className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
            role="status"
          >
            {message}
          </p>
        )}

        <IntegrationRow
          icon={<Calendar className="size-5 text-accent" strokeWidth={1.75} />}
          name="Google Calendar & Gmail"
          connected={status.google.connected}
          detail={
            status.google.connected
              ? `${status.google.email ?? "Connected"} · calendar: ${status.google.calendarId}`
              : "Not connected"
          }
          connectHref="/api/integrations/google/connect"
          onDisconnect={() => handleDisconnect("google")}
          disconnectDisabled={pending}
        />

        <IntegrationRow
          icon={<Share2 className="size-5 text-accent" strokeWidth={1.75} />}
          name="Facebook Page"
          connected={status.facebook.connected}
          detail={
            status.facebook.connected
              ? (status.facebook.pageName ?? status.facebook.pageId ?? "Connected")
              : "Not connected"
          }
          connectHref="/api/integrations/facebook/connect"
          onDisconnect={() => handleDisconnect("facebook")}
          disconnectDisabled={pending}
        />
      </CardContent>
    </Card>
  );
}

function IntegrationRow({
  icon,
  name,
  connected,
  detail,
  connectHref,
  onDisconnect,
  disconnectDisabled,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  detail: string;
  connectHref: string;
  onDisconnect: () => void;
  disconnectDisabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/45 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{name}</p>
            <Badge variant={connected ? "default" : "secondary"}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{detail}</p>
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
            <Button size="sm">Connect</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
