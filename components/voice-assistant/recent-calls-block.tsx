"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  importVoiceAssistantCalls,
  rescoreLegacyPhoneCalls,
} from "@/app/dashboard/voice-assistant/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClassificationBadge,
  LegacyScoreBadge,
  UrgentBadge,
} from "@/components/voice-assistant/scoring-explainer";
import {
  describeCallScore,
  isOutdatedCallScore,
  LEGACY_SCORE_NOTE,
  OLDER_SCORE_NOTE,
} from "@/lib/utils/call-score";
import {
  formatCallDuration,
  maskPhoneNumber,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

type RecentCallsBlockProps = {
  calls: PhoneCallRow[];
  isAdmin: boolean;
  hasAgent: boolean;
};

/**
 * FaithForm staff only: the assistant's scores, re-scoring and importing.
 * The Phone Calls page renders it inside "Assistant quality" for platform
 * admins only; churches see `CallsList` instead.
 */

/**
 * A guard on the re-score loop, not a quota: at five calls a round this is
 * three hundred calls in one sitting, more than any church log we have seen.
 * Anything left after that is one more click away.
 */
const MAX_RESCORE_ROUNDS = 60;

export function RecentCallsBlock({
  calls,
  isAdmin,
  hasAgent,
}: RecentCallsBlockProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rescoring, startRescore] = useTransition();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Every call scored under older rules, not only the "Not yet sorted" ones:
  // calls scored before names had to come from the transcript need reading
  // again too, even though their kind and score look current.
  const olderCount = calls.filter(isOutdatedCallScore).length;

  const handleImport = () => {
    startTransition(async () => {
      const result = await importVoiceAssistantCalls();
      if (!("ok" in result) || !result.ok) {
        toast.error("error" in result ? result.error : "Could not import calls.");
        return;
      }
      toast.success(
        result.imported > 0
          ? `Imported ${result.imported} call${result.imported === 1 ? "" : "s"} from Retell.`
          : "Your call log is already up to date.",
      );
    });
  };

  // One click, many rounds. Each round judges a handful of calls so no single
  // request runs long enough to be cut off, and the table refreshes between
  // rounds so the kinds fill in as it goes.
  const handleRescoreLegacy = () => {
    startRescore(async () => {
      let done = 0;
      let failed = 0;
      let remaining = olderCount;
      setProgress({ done: 0, total: olderCount });

      for (let round = 0; round < MAX_RESCORE_ROUNDS; round++) {
        const result = await rescoreLegacyPhoneCalls();
        if (!("ok" in result)) {
          toast.error(result.error);
          break;
        }
        done += result.rescored;
        failed += result.failed;
        remaining = result.remaining;
        setProgress({ done, total: done + remaining });
        if (remaining === 0 || result.rescored === 0) break;
      }

      setProgress(null);
      router.refresh();

      if (done === 0 && failed === 0) {
        toast.success("Every call is already scored by the current rubric.");
      } else if (failed > 0) {
        toast.warning(
          `Re-scored ${done} call${done === 1 ? "" : "s"}. ${failed} could not be scored; try again in a moment.`,
        );
      } else if (remaining > 0) {
        toast.success(
          `Re-scored ${done} calls so far. Click again to continue with the remaining ${remaining}.`,
        );
      } else {
        toast.success(`Re-scored ${done} older call${done === 1 ? "" : "s"}.`);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Scored calls</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            How the assistant handled each call, by the scoring rubric. The
            church sees summaries and who needs a call back, never these scores.
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {olderCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rescoring}
                onClick={handleRescoreLegacy}
                title={OLDER_SCORE_NOTE}
              >
                <Sparkles
                  className={`mr-1.5 size-3.5 ${rescoring ? "animate-pulse" : ""}`}
                  aria-hidden
                />
                {rescoring && progress
                  ? `Re-scoring ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : `Re-score ${olderCount} older call${olderCount === 1 ? "" : "s"}`}
              </Button>
            )}
            {hasAgent && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={handleImport}
              >
                <RefreshCw
                  className={`mr-1.5 size-3.5 ${pending ? "animate-spin" : ""}`}
                  aria-hidden
                />
                Sync from Retell
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Calls will appear here once your assistant is live. After you assign a
            phone number in Retell, new calls log automatically, or use Sync from
            Retell to pull recent history.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Caller</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Score</th>
                  <th className="pb-2 pr-4 font-medium">What happened</th>
                  <th className="pb-2 pl-2 font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const score = describeCallScore(call);

                  return (
                    <tr
                      key={call.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-2.5 pr-4 tabular-nums">
                        {new Date(call.called_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2.5 pr-4">
                        {maskPhoneNumber(call.caller_number)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {score.legacy && !score.classification ? (
                            <LegacyScoreBadge />
                          ) : (
                            <ClassificationBadge
                              classification={score.classification}
                            />
                          )}
                          <UrgentBadge view={score} />
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {formatCallDuration(call.duration_seconds)}
                      </td>
                      <td
                        className={`py-2.5 pr-4 font-medium tabular-nums ${score.toneClass}`}
                        title={score.legacy ? LEGACY_SCORE_NOTE : undefined}
                      >
                        {score.value ?? ""}
                        {score.value != null && (
                          <span className="font-normal text-muted-foreground">
                            /{score.outOf}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[240px] truncate py-2.5 pr-4 text-muted-foreground">
                        {score.summary ?? ""}
                      </td>
                      <td className="py-2.5 pl-2">
                        <Link
                          href={`/dashboard/call-log/${call.id}`}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
