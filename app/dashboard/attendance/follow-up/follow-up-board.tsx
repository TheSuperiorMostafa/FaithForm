"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@base-ui/react/checkbox";
import { AlertCircle, Check, PhoneOff, Send } from "lucide-react";

import { sendFollowUps } from "./actions";
import { Button } from "@/components/ui/button";
import type { RecordedService } from "@/lib/queries/attendance";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

export type FollowUpCandidate = {
  memberId: string;
  name: string;
  phone: string | null;
  /** Weeks missed in a row, counting this service. */
  consecutiveAbsent: number;
  sentAt: string | null;
  error: string | null;
  requested: boolean;
};

type FollowUpBoardProps = {
  services: RecordedService[];
  selectedDate: string;
  candidates: FollowUpCandidate[];
};

function streakBadge(weeks: number): string | null {
  if (weeks >= 4) return `Missed ${weeks} weeks in a row`;
  if (weeks >= 2) return `Missed ${weeks} weeks in a row`;
  return null;
}

export function FollowUpBoard({
  services,
  selectedDate,
  candidates,
}: FollowUpBoardProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();

  // Someone already texted for this service is history, not a choice.
  const pending = useMemo(
    () => candidates.filter((candidate) => !candidate.sentAt),
    [candidates],
  );
  const alreadySent = useMemo(
    () => candidates.filter((candidate) => candidate.sentAt),
    [candidates],
  );
  const reachable = useMemo(
    () => pending.filter((candidate) => Boolean(candidate.phone?.trim())),
    [pending],
  );

  const allReachableSelected =
    reachable.length > 0 &&
    reachable.every((candidate) => selected.has(candidate.memberId));

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function changeService(date: string) {
    setSelected(new Set());
    setError(null);
    setMessage(null);
    router.push(`/dashboard/attendance/follow-up?date=${date}`);
  }

  function handleSend() {
    setError(null);
    setMessage(null);

    startSending(async () => {
      const result = await sendFollowUps({
        serviceDate: selectedDate,
        memberIds: Array.from(selected),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSelected(new Set());
      setMessage(
        `Follow-up sent to ${result.requested} ${
          result.requested === 1 ? "person" : "people"
        }.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Follow-up
        </h1>
        <p className="text-base text-muted-foreground">
          Pick who should get a check-in text after a service. Attendance is
          submitted separately — nothing is sent until you choose here.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="follow-up-service"
          className="text-sm font-semibold text-foreground"
        >
          Service
        </label>
        <select
          id="follow-up-service"
          value={selectedDate}
          onChange={(e) => changeService(e.target.value)}
          className="min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-card px-4 text-base text-foreground outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {services.map((service) => (
            <option key={service.serviceDate} value={service.serviceDate}>
              {formatServiceDate(service.serviceDate)} — {service.totalAbsent}{" "}
              absent
            </option>
          ))}
        </select>
      </div>

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-base text-muted-foreground">
          Everyone was present that Sunday. Nothing to follow up on.
        </p>
      ) : null}

      {pending.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Who missed this service
            </h2>
            {reachable.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    allReachableSelected
                      ? new Set()
                      : new Set(reachable.map((c) => c.memberId)),
                  )
                }
                className="text-sm font-semibold text-accent hover:underline"
              >
                {allReachableSelected ? "Clear all" : "Select everyone"}
              </button>
            ) : null}
          </div>

          <ul className="flex flex-col gap-2">
            {pending.map((candidate) => {
              const hasPhone = Boolean(candidate.phone?.trim());
              const checked = selected.has(candidate.memberId);
              const badge = streakBadge(candidate.consecutiveAbsent);

              return (
                <li
                  key={candidate.memberId}
                  className={cn(
                    "flex min-h-[4.5rem] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card dark:shadow-none",
                    candidate.consecutiveAbsent >= 4 &&
                      "border-amber-400/50 bg-amber-100/60 dark:bg-amber-500/10",
                    !hasPhone && "opacity-70",
                  )}
                >
                  <label
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3",
                      hasPhone ? "cursor-pointer" : "cursor-not-allowed",
                    )}
                  >
                    <Checkbox.Root
                      checked={checked}
                      disabled={!hasPhone}
                      onCheckedChange={() => toggle(candidate.memberId)}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-input bg-background data-[checked]:border-accent data-[checked]:bg-accent data-[disabled]:opacity-50"
                    >
                      <Checkbox.Indicator className="text-accent-foreground">
                        <Check className="size-4" strokeWidth={1.75} />
                      </Checkbox.Indicator>
                    </Checkbox.Root>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-base font-medium text-foreground">
                        {candidate.name}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {badge ? (
                          <span
                            className={cn(
                              "inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold",
                              candidate.consecutiveAbsent >= 4
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                                : "bg-accent/15 text-accent",
                            )}
                          >
                            {badge}
                          </span>
                        ) : null}
                        {!hasPhone ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <PhoneOff className="size-3.5" strokeWidth={1.75} />
                            No phone on file
                          </span>
                        ) : null}
                        {candidate.error ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                            <AlertCircle
                              className="size-3.5"
                              strokeWidth={1.75}
                            />
                            {candidate.error}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {alreadySent.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Already followed up ({alreadySent.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {alreadySent.map((candidate) => (
              <li
                key={candidate.memberId}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <Check
                  className="size-5 shrink-0 text-green-700 dark:text-green-300"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-base font-medium text-foreground">
                  {candidate.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  Sent
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="text-base text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-base font-semibold text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <div className="sticky bottom-20 z-40 -mx-1 rounded-xl border border-border bg-background/95 px-3 py-3 shadow-card backdrop-blur md:bottom-0 dark:shadow-none">
          <Button
            type="button"
            size="lg"
            className="h-14 w-full gap-2 text-base"
            disabled={selected.size === 0 || isSending}
            onClick={handleSend}
          >
            <Send className="size-5" strokeWidth={1.75} aria-hidden />
            {isSending
              ? "Sending…"
              : selected.size === 0
                ? "Select who to follow up with"
                : `Send follow-up to ${selected.size}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
