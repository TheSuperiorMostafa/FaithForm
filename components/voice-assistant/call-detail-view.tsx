"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { rescorePhoneCall } from "@/app/dashboard/voice-assistant/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCallDuration,
  maskPhoneNumber,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

type CallDetailViewProps = {
  call: PhoneCallRow;
  isAdmin: boolean;
};

function formatScore(score: number | null): string {
  if (score == null || Number.isNaN(Number(score))) return "—";
  return String(Math.round(Number(score)));
}

export function CallDetailView({ call, isAdmin }: CallDetailViewProps) {
  const [pending, startTransition] = useTransition();
  const rationale =
    typeof call.score_breakdown?.rationale === "string"
      ? call.score_breakdown.rationale
      : null;

  const handleRescore = () => {
    startTransition(async () => {
      const result = await rescorePhoneCall(call.id);
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result ? result.error : "Could not re-score this call.",
        );
        return;
      }
      toast.success(
        result.score != null
          ? `Re-scored: ${Math.round(result.score)}`
          : "Call re-scored.",
      );
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
            Call details
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(call.called_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {" · "}
            {maskPhoneNumber(call.caller_number)}
          </p>
        </div>
        {isAdmin && call.transcript && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={handleRescore}
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${pending ? "animate-spin" : ""}`}
              aria-hidden
            />
            Re-score
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Duration</dt>
              <dd className="mt-0.5 text-sm tabular-nums">
                {formatCallDuration(call.duration_seconds)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sentiment</dt>
              <dd className="mt-0.5 text-sm capitalize">
                {call.sentiment ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Successful</dt>
              <dd className="mt-0.5 text-sm">
                {call.call_successful == null
                  ? "—"
                  : call.call_successful
                    ? "Yes"
                    : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">AI score</dt>
              <dd className="mt-0.5 text-sm tabular-nums font-medium">
                {formatScore(call.ai_score)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {(call.ai_score != null || rationale) && (
        <Card>
          <CardHeader>
            <CardTitle>Scoring</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold tabular-nums">
              {formatScore(call.ai_score)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / 100
              </span>
            </p>
            {rationale && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {rationale}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {(call.outcome || call.notes) && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">
              {call.outcome ?? call.notes}
            </p>
          </CardContent>
        </Card>
      )}

      {call.recording_url && (
        <Card>
          <CardHeader>
            <CardTitle>Recording</CardTitle>
          </CardHeader>
          <CardContent>
            <audio
              controls
              preload="metadata"
              className="w-full"
              src={call.recording_url}
            >
              Your browser does not support audio playback.
            </audio>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {call.transcript ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {call.transcript}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No transcript available for this call yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
