"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleDashed, Link2, Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  provisionVoicePhoneNumber,
  syncVoicePhoneNumber,
} from "@/app/dashboard/voice-assistant/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoiceAgentSyncStatus } from "@/types/voice-assistant";

type AgentStatusCardProps = {
  status: VoiceAgentSyncStatus;
  isAdmin?: boolean;
};

function toTelHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

export function AgentStatusCard({
  status,
  isAdmin = false,
}: AgentStatusCardProps) {
  const [areaCode, setAreaCode] = useState("");
  const [pending, startTransition] = useTransition();
  const isLinked = status.agentMode === "linked";
  const isLive = Boolean(status.agentId && status.syncedAt);
  const hasNumber = Boolean(status.phoneNumber?.trim());

  const handleProvision = () => {
    startTransition(async () => {
      const result = await provisionVoicePhoneNumber({
        areaCode: areaCode.trim() || undefined,
      });
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result ? result.error : "Could not set up a phone number.",
        );
        return;
      }
      toast.success(
        result.created
          ? `Phone number ready: ${result.phoneNumber}`
          : `Using existing number: ${result.phoneNumber}`,
      );
    });
  };

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncVoicePhoneNumber();
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result
            ? result.error
            : "Could not sync the phone number.",
        );
        return;
      }
      toast.success(
        result.phoneNumber
          ? `Synced: ${result.phoneNumber}`
          : "No number is bound to this agent in Retell yet.",
      );
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="size-4 text-accent" aria-hidden />
          Your phone assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-start gap-2">
          {isLinked ? (
            <Link2
              className="mt-0.5 size-4 shrink-0 text-accent"
              aria-hidden
            />
          ) : isLive ? (
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
              {isLinked
                ? "Linked to your existing Retell agent"
                : isLive
                  ? "Agent created and connected to FaithForm"
                  : "Not connected yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLinked
                ? "FaithForm won’t modify this agent — call logs, transcripts, and scoring still flow in automatically."
                : isLive
                  ? "Save settings to keep the agent up to date, then get a number to start receiving calls."
                  : "Complete required settings and save to create your church’s voice agent."}
            </p>
          </div>
        </div>

        {hasNumber ? (
          <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Call this number to test
            </p>
            <a
              href={toTelHref(status.phoneNumber!)}
              className="mt-1 block font-heading text-2xl font-bold tracking-tight text-foreground hover:text-accent"
            >
              {status.phoneNumber}
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Dial from your phone — the AI will answer with your greeting.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-4">
            <p className="font-medium">No dial-in number yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isLinked
                ? "Bind a phone number to this agent in Retell, then use Refresh from Retell to pull it in here."
                : "Each church gets its own Retell number bound to this agent. Save settings first if you haven’t created the agent."}
            </p>
          </div>
        )}

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
          </dl>
        )}

        {isAdmin && (
          <div className="space-y-3 border-t border-border pt-3">
            {isLinked ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={handleSync}
                >
                  <RefreshCw
                    className={`mr-1.5 size-3.5 ${pending ? "animate-spin" : ""}`}
                    aria-hidden
                  />
                  Refresh from Retell
                </Button>
              </div>
            ) : (
              <>
                {!hasNumber && (
                  <div className="space-y-2">
                    <Label htmlFor="area-code">Preferred area code (optional)</Label>
                    <Input
                      id="area-code"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="e.g. 615"
                      value={areaCode}
                      disabled={pending}
                      onChange={(e) =>
                        setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
                      }
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {!hasNumber ? (
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={handleProvision}
                    >
                      {pending ? "Setting up…" : "Get a phone number"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={handleSync}
                    >
                      <RefreshCw
                        className={`mr-1.5 size-3.5 ${pending ? "animate-spin" : ""}`}
                        aria-hidden
                      />
                      Refresh from Retell
                    </Button>
                  )}
                </div>
                {!hasNumber && (
                  <p className="text-xs text-muted-foreground">
                    Buys a US number from Retell and binds it to this church’s
                    agent. Save settings first if the agent isn’t created yet.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
