"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@base-ui/react/checkbox";
import { AlertCircle, Check, Hash, MessageSquare, Pencil, PhoneOff, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";

import { sendFollowUps } from "../actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { describeFollowUpFailure } from "@/lib/attendance/follow-up-errors";
import {
  NAME_PLACEHOLDER,
  describeTemplateAudience,
  groupFollowUpMessages,
  personalizeFollowUpMessage,
  validateFollowUpOverride,
} from "@/lib/attendance/follow-up-message";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

export type FollowUpCandidate = {
  memberId: string;
  name: string;
  firstName: string;
  phone: string | null;
  /** Weeks missed in a row, counting this service. */
  consecutiveAbsent: number;
  sentAt: string | null;
  /** Raw text from the texting service. Never shown; mapped to a plain reason. */
  error: string | null;
  requested: boolean;
};

type FollowUpBoardProps = {
  selectedDate: string;
  candidates: FollowUpCandidate[];
  /** Whether this church has its own texting phone. Without one, nothing is sent. */
  textingConnected: boolean;
  /** The church's saved messages, one per number of Sundays missed in a row. */
  templates: string[];
  /** The Sunday was counted as one number, so there are no names. */
  countedByNumber: boolean;
};

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function texts(n: number) {
  return `${n} ${n === 1 ? "text" : "texts"}`;
}

export function FollowUpBoard({
  selectedDate,
  candidates,
  textingConnected,
  templates,
  countedByNumber,
}: FollowUpBoardProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  // null = each person gets the church's saved message for their streak.
  const [customMessage, setCustomMessage] = useState<string | null>(null);

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

  const chosen = useMemo(
    () => reachable.filter((candidate) => selected.has(candidate.memberId)),
    [reachable, selected],
  );
  // With nobody picked yet, preview what everyone reachable would get.
  const previewFor = chosen.length > 0 ? chosen : reachable;
  const groups = useMemo(() => groupFollowUpMessages(previewFor, templates), [previewFor, templates]);
  const sample = previewFor[0] ?? null;
  const customCheck = customMessage === null ? null : validateFollowUpOverride(customMessage);

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

  async function handleSend() {
    setError(null);
    const count = chosen.length;
    if (count === 0) return;
    if (customCheck && !customCheck.ok) {
      setError(customCheck.error);
      return;
    }

    const ok = await confirmAction({
      title: `Text ${people(count)} now?`,
      description: textingConnected
        ? `Each person gets the message shown, with their own first name. A text can't be taken back once it's sent.`
        : `Your church's texting phone isn't connected yet, so they'll be marked for follow-up but no texts will go out.`,
      confirmLabel: `Send ${texts(count)}`,
      destructive: true,
    });
    if (!ok) return;

    startSending(async () => {
      try {
        const result = await sendFollowUps({
          serviceDate: selectedDate,
          memberIds: chosen.map((candidate) => candidate.memberId),
          ...(customCheck?.ok ? { message: customCheck.message } : {}),
        });

        if (!result.ok) {
          setError(result.error);
          return;
        }

        setSelected(new Set());
        if (result.notConnected) {
          setError(
            `Saved ${people(result.requested)} for follow-up, but no texts went out: your church's texting phone isn't connected yet.`,
          );
        } else if (result.sent < result.requested) {
          toast.warning(
            `Texted ${people(result.sent)}. ${people(result.requested - result.sent)} couldn't be texted. The reasons are next to their names.`,
          );
        } else {
          toast.success(`Sent ${texts(result.sent)} for ${formatServiceDate(selectedDate)}.`);
        }
        router.refresh();
      } catch {
        setError("We couldn't send the texts. Check your connection and try again. Nothing was sent twice.");
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {!textingConnected && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
          <p>
            Texting isn&rsquo;t connected for your church yet, so follow-ups
            are saved but no texts go out. Contact FaithForm support to connect
            your church&rsquo;s own phone.
          </p>
        </div>
      )}

      {countedByNumber ? (
        <EmptyState
          icon={Hash}
          title="This Sunday was counted as one number"
          description="There are no names, so there's nobody to text. Count a Sunday by name to follow up with who missed."
        />
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={Check}
          title="Everyone was here"
          description="Nobody on the list missed this Sunday. Nothing to follow up on."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            {pending.length > 0 ? (
              <section className="flex flex-col gap-3" aria-labelledby="missed-heading">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="missed-heading" className="font-heading text-xl font-bold text-foreground">
                    Who missed this Sunday
                  </h2>
                  {reachable.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setSelected(
                          allReachableSelected
                            ? new Set()
                            : new Set(reachable.map((c) => c.memberId)),
                        )
                      }
                    >
                      {allReachableSelected ? "Clear all" : "Choose everyone with a phone"}
                    </Button>
                  ) : null}
                </div>

                <ul className="flex flex-col gap-2">
                  {pending.map((candidate) => {
                    const hasPhone = Boolean(candidate.phone?.trim());
                    const checked = selected.has(candidate.memberId);
                    const failure = describeFollowUpFailure(candidate.error);

                    return (
                      <li key={candidate.memberId}>
                        <label
                          className={cn(
                            "flex min-h-[4.5rem] items-center gap-4 rounded-2xl border bg-card px-4 py-3 shadow-card transition-colors dark:shadow-none",
                            checked ? "border-accent bg-accent/[0.06]" : "border-border",
                            candidate.consecutiveAbsent >= 4 && !checked && "border-amber-400/50",
                            hasPhone ? "cursor-pointer hover:border-accent/50" : "cursor-not-allowed opacity-70",
                          )}
                        >
                          <Checkbox.Root
                            checked={checked}
                            disabled={!hasPhone}
                            onCheckedChange={() => toggle(candidate.memberId)}
                            aria-label={`Text ${candidate.name}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded-lg border-2 border-input bg-background data-[checked]:border-accent data-[checked]:bg-accent data-[disabled]:opacity-50"
                          >
                            <Checkbox.Indicator className="text-accent-foreground">
                              <Check className="size-5" strokeWidth={2} />
                            </Checkbox.Indicator>
                          </Checkbox.Root>

                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-base font-medium text-foreground">{candidate.name}</span>
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                              {candidate.consecutiveAbsent >= 2 ? (
                                <span
                                  className={cn(
                                    "font-semibold",
                                    candidate.consecutiveAbsent >= 4
                                      ? "text-amber-700 dark:text-amber-300"
                                      : "text-accent",
                                  )}
                                >
                                  Missed {candidate.consecutiveAbsent} Sundays in a row
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Missed this Sunday</span>
                              )}
                              {!hasPhone ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <PhoneOff className="size-4" strokeWidth={1.75} aria-hidden />
                                  No phone number on file
                                </span>
                              ) : null}
                              {failure ? (
                                <span className="inline-flex items-center gap-1 font-medium text-destructive">
                                  <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden />
                                  {failure}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {alreadySent.length > 0 ? (
              <section className="flex flex-col gap-3" aria-labelledby="sent-heading">
                <h2 id="sent-heading" className="font-heading text-xl font-bold text-foreground">
                  Already texted ({alreadySent.length})
                </h2>
                <ul className="flex flex-col gap-2">
                  {alreadySent.map((candidate) => (
                    <li
                      key={candidate.memberId}
                      className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                    >
                      <span className="min-w-0 flex-1 text-base font-medium text-foreground">
                        {candidate.name}
                      </span>
                      <StatusBadge tone="done">Text sent</StatusBadge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {pending.length > 0 ? (
            <aside className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card lg:sticky lg:top-6 dark:shadow-none">
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-lg font-semibold text-foreground">The text they&apos;ll get</h2>
                <p className="text-[15px] text-muted-foreground">
                  {chosen.length === 0
                    ? "Choose people on the list to see exactly what each one gets."
                    : `Shown as ${sample?.firstName ?? "they"} will read it. Everyone gets their own first name.`}
                </p>
              </div>

              {customMessage === null ? (
                <div className="flex flex-col gap-4">
                  {groups.length === 0 ? (
                    <p className="text-[15px] text-muted-foreground">
                      Nobody on this list has a phone number, so there&apos;s nobody to text.
                    </p>
                  ) : (
                    groups.map((group) => (
                      <figure key={group.index} className="flex flex-col gap-2">
                        {groups.length > 1 ? (
                          <figcaption className="text-sm font-semibold text-muted-foreground">
                            For {people(group.count)} who {describeTemplateAudience(group.index)}
                          </figcaption>
                        ) : null}
                        <MessageBubble text={group.preview} />
                      </figure>
                    ))
                  )}
                  {groups.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCustomMessage(groups[0]?.template ?? "")}
                    >
                      <Pencil aria-hidden />
                      Change the message for this send
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Label htmlFor="follow-up-message" className="text-base font-semibold">
                    Your message
                  </Label>
                  <Textarea
                    id="follow-up-message"
                    value={customMessage}
                    rows={5}
                    onChange={(event) => setCustomMessage(event.target.value)}
                    aria-invalid={customCheck && !customCheck.ok ? true : undefined}
                    aria-describedby="follow-up-message-help"
                    className="text-base"
                  />
                  <p id="follow-up-message-help" className="text-sm text-muted-foreground">
                    Put {NAME_PLACEHOLDER} where each person&apos;s first name goes. Everyone you
                    chose gets this one message. Your saved messages in Settings don&apos;t change.
                  </p>
                  {customCheck && !customCheck.ok ? (
                    <p className="text-sm font-medium text-destructive" role="alert">
                      {customCheck.error}
                    </p>
                  ) : sample ? (
                    <figure className="flex flex-col gap-2">
                      <figcaption className="text-sm font-semibold text-muted-foreground">
                        How it reads for {sample.firstName}
                      </figcaption>
                      <MessageBubble text={personalizeFollowUpMessage(customMessage, sample.firstName)} />
                    </figure>
                  ) : null}
                  <Button type="button" variant="ghost" onClick={() => setCustomMessage(null)}>
                    <RotateCcw aria-hidden />
                    Use the usual messages
                  </Button>
                </div>
              )}

              {error ? (
                <p className="text-base text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="button"
                size="lg"
                className="h-14 w-full text-base"
                disabled={chosen.length === 0 || isSending || Boolean(customCheck && !customCheck.ok)}
                onClick={() => void handleSend()}
              >
                <Send className="size-5" strokeWidth={1.75} aria-hidden />
                {isSending
                  ? "Sending…"
                  : chosen.length === 0
                    ? "Choose who to text"
                    : `Send ${texts(chosen.length)}`}
              </Button>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ text }: { text: string }) {
  return (
    <p className="flex gap-2 rounded-2xl rounded-bl-md bg-muted px-4 py-3 text-[15px] leading-relaxed text-foreground">
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <span className="whitespace-pre-line">{text}</span>
    </p>
  );
}
