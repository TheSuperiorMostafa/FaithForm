"use client";

import { CheckCircle2, CircleDashed, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoiceAgentSyncStatus } from "@/types/voice-assistant";

type AgentStatusCardProps = {
  status: VoiceAgentSyncStatus;
};

export function AgentStatusCard({ status }: AgentStatusCardProps) {
  const isLive = Boolean(status.agentId && status.syncedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="size-4 text-accent" aria-hidden />
          Your phone assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2">
          {isLive ? (
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400"
              aria-hidden
            />
          ) : (
            <CircleDashed
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <div>
            <p className="font-medium">
              {isLive
                ? "Agent created and connected to FaithForm"
                : "Not connected yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLive
                ? "Each church gets its own Retell agent. Save your settings to keep it up to date."
                : "Save your settings once to create your church's voice agent."}
            </p>
          </div>
        </div>

        {status.agentId && (
          <dl className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Agent ID</dt>
              <dd className="truncate font-mono">{status.agentId}</dd>
            </div>
            {status.syncedAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Last synced</dt>
                <dd>
                  {new Date(status.syncedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            )}
            {status.phoneNumber && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">AI phone line</dt>
                <dd>{status.phoneNumber}</dd>
              </div>
            )}
          </dl>
        )}

        <p className="text-xs text-muted-foreground">
          Calls are logged automatically via webhook to your dashboard. Assign a
          phone number to this agent in your Retell dashboard to go live.
        </p>
      </CardContent>
    </Card>
  );
}
