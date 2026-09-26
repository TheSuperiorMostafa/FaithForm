"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { CallListItem } from "@/app/dashboard/call-log/call-view";
import { rescorePhoneCall } from "@/app/dashboard/voice-assistant/actions";
import {
  CallBackButton,
  MarkHandledButton,
} from "@/components/voice-assistant/call-follow-up";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ClassificationBadge,
  LegacyScoreBadge,
  UrgentBadge,
} from "@/components/voice-assistant/scoring-explainer";
import { describeCallScore, LEGACY_SCORE_NOTE } from "@/lib/utils/call-score";
import { formatCallDuration } from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

type CallDetailViewProps = {
  /** The row with its raw number removed; the caller comes from `item`. */
  call: PhoneCallRow;
  item: CallListItem;
  isAdmin: boolean;
  /** Church admin, and the database has the handled columns. */
  canMarkHandled: boolean;
  /** FaithForm platform admin: sees the assistant's score and rubric. */
  isStaff: boolean;
};

/**
 * One call, in the order a pastor needs it: what the caller wanted, whether
 * someone still has to ring them back, then the recording and the transcript.
 * How well the assistant did is FaithForm's concern and sits in a staff-only
 * section at the bottom.
 */
export function CallDetailView({
  call,
  item,
  isAdmin,
  canMarkHandled,
  isStaff,
}: CallDetailViewProps) {
  const score = describeCallScore(call);

  return (
    <div className="flex w-full flex-col gap-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-xl">What they wanted</CardTitle>
            <StatusBadge tone={item.statusTone}>{item.statusLabel}</StatusBadge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-base leading-relaxed text-foreground">
            {item.summary ??
              "There's no summary for this call yet. Listen to the recording or read the transcript below."}
          </p>
          {item.urgent && (
            <p className="rounded-2xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 dark:bg-orange-500/15 dark:text-orange-100">
              The caller sounded like they need help right away: in distress,
              grieving, or worried about someone&rsquo;s safety. Please call
              them back soon.
            </p>
          )}
          {(item.dial || canMarkHandled) && (item.needsCallBack || item.handled || item.dial) && (
            <div className="flex flex-wrap gap-3">
              {item.dial && (
                <CallBackButton
                  dial={item.dial}
                  callerLabel={item.callerLabel}
                  size="lg"
                  primary
                />
              )}
              {canMarkHandled && (item.needsCallBack || item.handled) && (
                <MarkHandledButton
                  callId={item.id}
                  callerLabel={item.callerLabel}
                  handled={item.handled}
                  size="lg"
                  primary={!item.dial}
                />
              )}
            </div>
          )}
          {!item.dial && item.needsCallBack && (
            <p className="text-[15px] text-muted-foreground">
              The caller&rsquo;s full number is hidden. To reach them, check
              the recording or transcript for a number they left.
            </p>
          )}
        </CardContent>
      </Card>

      {call.recording_url && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Listen to the call</CardTitle>
          </CardHeader>
          <CardContent>
            <audio controls preload="metadata" className="w-full" src={call.recording_url}>
              Your browser can&rsquo;t play this recording.
            </audio>
          </CardContent>
        </Card>
      )}

      <AdvancedSection
        title="Read the transcript"
        description="Everything that was said on the call, word for word."
      >
        {call.transcript ? (
          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
            {call.transcript}
          </pre>
        ) : (
          <p className="text-[15px] text-muted-foreground">
            There&rsquo;s no transcript for this call yet.
          </p>
        )}
      </AdvancedSection>

      {isStaff && (
        <AdvancedSection
          title="Assistant quality"
          description="How the assistant handled this call. Churches don't see this section."
        >
          <StaffCallQuality call={call} isAdmin={isAdmin} score={score} />
        </AdvancedSection>
      )}
    </div>
  );
}

function StaffCallQuality({
  call,
  isAdmin,
  score,
}: {
  call: PhoneCallRow;
  isAdmin: boolean;
  score: ReturnType<typeof describeCallScore>;
}) {
  const [pending, startTransition] = useTransition();
  const assistantSummary = call.outcome?.trim() || call.notes?.trim() || null;

  const handleRescore = () => {
    startTransition(async () => {
      const result = await rescorePhoneCall(call.id);
      if (!("ok" in result) || !result.ok) {
        toast.error(
          "error" in result ? result.error : "We couldn't re-score this call. Please try again.",
        );
        return;
      }
      toast.success(
        result.score != null
          ? `Call re-scored: ${Math.round(result.score)} / 10.`
          : "Call re-scored.",
      );
    });
  };

  return (
    <div className="flex flex-col gap-5 text-[15px]">
      {isAdmin && call.transcript && (
        <div>
          <Button type="button" variant="outline" disabled={pending} onClick={handleRescore}>
            <RefreshCw
              className={`size-5 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden
            />
            Re-score this call
          </Button>
        </div>
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Duration</dt>
          <dd className="mt-0.5 tabular-nums">{formatCallDuration(call.duration_seconds)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Sentiment</dt>
          <dd className="mt-0.5 capitalize">{call.sentiment ?? ""}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Successful</dt>
          <dd className="mt-0.5">
            {call.call_successful == null ? "" : call.call_successful ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Call type</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {score.classification ? (
              <ClassificationBadge classification={score.classification} />
            ) : score.legacy ? (
              <LegacyScoreBadge />
            ) : (
              ""
            )}
            <UrgentBadge view={score} />
          </dd>
        </div>
      </dl>

      {score.value != null && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className={`text-3xl font-semibold tabular-nums ${score.toneClass}`}>
            {score.value}
            <span className="ml-1 text-base font-normal text-muted-foreground">/ {score.outOf}</span>
          </p>
          {score.legacy && <p className="text-sm text-muted-foreground">{LEGACY_SCORE_NOTE}</p>}
          {score.classificationHelp && (
            <p className="text-sm text-muted-foreground">{score.classificationHelp}</p>
          )}
        </div>
      )}

      {(score.callerMood || score.flagReason || score.missingKnowledge) && (
        <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          {score.callerMood && (
            <div>
              <dt className="text-sm text-muted-foreground">Caller mood</dt>
              <dd className="mt-0.5 capitalize">{score.callerMood}</dd>
            </div>
          )}
          {score.flagReason && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">What went wrong</dt>
              <dd className="mt-0.5 leading-relaxed">{score.flagReason}</dd>
            </div>
          )}
          {score.missingKnowledge && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">What the assistant did not know</dt>
              <dd className="mt-0.5 leading-relaxed">{score.missingKnowledge}</dd>
            </div>
          )}
        </dl>
      )}

      {assistantSummary && assistantSummary !== score.summary && (
        <div className="space-y-1 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">The phone service&rsquo;s own summary</p>
          <p className="leading-relaxed">{assistantSummary}</p>
        </div>
      )}
    </div>
  );
}
