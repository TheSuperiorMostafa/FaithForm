"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Mail, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createWeeklyAnnouncementDraftAction,
  toggleEventInWeeklyEmail,
} from "@/app/dashboard/announcements/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { countLabel } from "@/lib/announcements/composer";
import type { WeeklyEmailDraftLink } from "@/lib/announcements/email-delivery";
import { cn } from "@/lib/utils";

export type WeeklyEmailEntry = {
  key: string;
  title: string;
  when: string;
  /** A calendar event put in the email on its own, which can be taken out here. */
  queuedEvent?: { googleEventId: string; calendarId: string | null };
};

export type WeeklyEmailCandidate = {
  googleEventId: string;
  calendarId: string | null;
  title: string;
  when: string;
};

/**
 * Monday's email as one calm card: how many announcements are in it, and one
 * button to make the draft now. What's in it, and adding calendar events to
 * it, sit one click down.
 */
export function WeeklyEmailCard({
  available,
  switchedOff,
  draftLink,
  weekLabel,
  draftCreatedThisWeek,
  isAdmin,
  entries,
  candidates,
}: {
  available: boolean;
  switchedOff: boolean;
  draftLink: WeeklyEmailDraftLink | null;
  weekLabel: string;
  draftCreatedThisWeek: boolean;
  isAdmin: boolean;
  entries: WeeklyEmailEntry[];
  candidates: WeeklyEmailCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "problem"; text: string } | null>(null);
  const mailbox = draftLink?.provider === "icloud" ? "iCloud Mail" : "Gmail";

  const createDraft = (force: boolean) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await createWeeklyAnnouncementDraftAction({ force });
        if (result.error) {
          setMessage({ tone: "problem", text: result.error });
          return;
        }
        const text = `Monday's email is ready in ${mailbox} with ${countLabel(
          result.eventCount ?? 0,
          "announcement",
        )}. Open it to check it and send it.`;
        setMessage({ tone: "done", text });
        toast.success(text);
        router.refresh();
      } catch {
        setMessage({
          tone: "problem",
          text: "We couldn't reach FaithForm. Nothing was changed. Please try again.",
        });
      }
    });
  };

  const toggle = (
    event: { googleEventId: string; calendarId: string | null; title: string },
    included: boolean,
  ) => {
    startTransition(async () => {
      try {
        const result = await toggleEventInWeeklyEmail({
          googleEventId: event.googleEventId,
          calendarId: event.calendarId,
          included,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          included
            ? `“${event.title}” added to Monday's email.`
            : `“${event.title}” taken out of Monday's email.`,
        );
        router.refresh();
      } catch {
        toast.error("We couldn't reach FaithForm. Nothing was changed. Please try again.");
      }
    });
  };

  return (
    <section
      aria-labelledby="weekly-email-heading"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Mail className="size-6" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="weekly-email-heading" className="font-heading text-xl font-bold text-foreground">
            Monday&apos;s email
          </h2>
          <p className="text-[15px] text-muted-foreground">
            {switchedOff || !available
              ? weekLabel
              : `${countLabel(entries.length, "announcement")} · ${weekLabel}`}
          </p>
        </div>
      </div>

      {switchedOff ? (
        <p className="text-[15px] text-muted-foreground">
          Announcement emails are switched off for your church. Contact FaithForm
          support if you&apos;d like them back on.
        </p>
      ) : !available ? (
        <>
          <p className="text-[15px] text-muted-foreground">
            Connect Google or iCloud Mail and FaithForm puts this week&apos;s
            announcements into one email draft every Monday.
          </p>
          <Link
            href="/dashboard/settings?tab=accounts"
            className={cn(buttonVariants({ variant: "outline" }), "self-start")}
          >
            Connect email
          </Link>
        </>
      ) : (
        <>
          {draftCreatedThisWeek && (
            <StatusBadge tone="done" className="self-start">
              This week&apos;s draft is made
            </StatusBadge>
          )}
          <p className="text-[15px] text-muted-foreground">
            Every Monday FaithForm puts these into one email draft in {mailbox} for you
            to check and send.
          </p>

          {message && (
            <p
              role={message.tone === "problem" ? "alert" : "status"}
              className={cn(
                "rounded-xl px-4 py-3 text-[15px]",
                message.tone === "problem"
                  ? "border border-destructive/30 bg-destructive/5 text-destructive"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
              )}
            >
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {isAdmin && (
              <Button
                variant="outline"
                disabled={pending || entries.length === 0}
                onClick={() => createDraft(draftCreatedThisWeek)}
              >
                <Mail aria-hidden strokeWidth={1.75} />
                {pending ? "Making the draft…" : draftCreatedThisWeek ? "Make the draft again" : "Create draft now"}
              </Button>
            )}
            {draftLink && (
              <a
                href={draftLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "ghost" })}
              >
                {draftLink.label}
                <ExternalLink aria-hidden className="size-4" />
              </a>
            )}
          </div>

          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((v) => !v)}
            className="flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-[15px] font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                "size-5 text-muted-foreground transition-transform motion-reduce:transition-none",
                showDetails && "rotate-180",
              )}
            />
            {showDetails ? "Hide what's in it" : "Show what's in it"}
          </button>

          {showDetails && (
            <div className="flex flex-col gap-4">
              {entries.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">
                  Nothing yet. Tick &ldquo;Monday&apos;s weekly email&rdquo; when you post an
                  announcement, or add an event below.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                  {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold">{entry.title}</span>
                        <span className="block text-sm text-muted-foreground">{entry.when}</span>
                      </span>
                      {isAdmin && entry.queuedEvent && (
                        <Button
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            toggle({ ...entry.queuedEvent!, title: entry.title }, false)
                          }
                        >
                          <Minus aria-hidden />
                          Take out
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isAdmin && candidates.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[15px] font-semibold">Add from your calendar</p>
                  <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                    {candidates.map((event) => (
                      <li key={event.googleEventId} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{event.title}</span>
                          <span className="block text-sm text-muted-foreground">{event.when}</span>
                        </span>
                        <Button variant="ghost" disabled={pending} onClick={() => toggle(event, true)}>
                          <Plus aria-hidden />
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Link
        href="/dashboard/settings?tab=messages"
        className="w-fit text-[15px] font-semibold text-primary underline-offset-4 hover:underline dark:text-accent"
      >
        Change the email template
      </Link>
    </section>
  );
}
