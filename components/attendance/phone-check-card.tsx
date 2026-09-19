"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, RefreshCw, Smartphone } from "lucide-react";

import type { PhoneCheck, PhoneCheckVerdict } from "@/lib/attendance/v2/phone-check";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Readiness = {
  problem: "geofence_disabled" | "no_campus_configured" | null;
  watching: { campusName: string; radiusMeters: number }[];
};

const REASON_PHRASES: Record<PhoneCheckVerdict, string> = {
  ready: "is ready",
  no_people_link: "hasn't connected your app account to a People record",
  geofence_disabled: "hasn't switched automatic check-in on",
  no_campus_configured: "hasn't put its building on the map",
  not_enrolled: "isn't available to your account",
};

type Item = {
  state: "done" | "todo" | "problem";
  title: string;
  detail?: string;
  action?: { label: string; href?: string; onClick?: () => void };
};

/**
 * "Would it work on my phone?", for the person setting check-in up.
 *
 * Checks their own app account the way the app does — the same four things,
 * in the same order — and says what to do about each one that fails. Also
 * says when the message on their phone is about a different church: the app
 * asks every church the account follows or has joined, and when all of them
 * refuse, the version in people's hands reports whichever sorts first.
 */
export function PhoneCheckCard({
  phone,
  churchName,
  readiness,
  onOpenStep,
}: {
  phone: PhoneCheck | null;
  churchName: string;
  readiness: Readiness;
  onOpenStep: (step: "location" | "live") => void;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const recheck = () => startRefresh(() => router.refresh());

  let items: Item[] = [];
  if (phone?.hasAppAccount) {
    const membership: Item =
      phone.membership === "joined"
        ? { state: "done", title: `You're a member of ${churchName} in the app` }
        : phone.membership === "pending"
          ? {
              state: "problem",
              title: "Your request to join is waiting for approval",
              detail: "Approve it under Requests to join.",
              action: { label: "Open People", href: "/dashboard/people" },
            }
          : phone.membership === "following"
            ? {
                state: "problem",
                title: `You follow ${churchName}, but haven't joined`,
                detail: "Open the church in the FaithForm app and tap Join. Only members are checked in.",
              }
            : {
                state: "problem",
                title: `You haven't joined ${churchName} in the app`,
                detail: "Open the FaithForm app, find your church and tap Join.",
              };

    const connection: Item =
      phone.connection === "linked"
        ? {
            state: "done",
            title: "Your app account is connected to your People record",
            detail: phone.linkedPersonName ?? undefined,
          }
        : phone.connection === "awaiting_confirmation"
          ? {
              state: "problem",
              title: "Confirm which person in People you are",
              detail: "Someone in People has your name, so FaithForm asked instead of guessing.",
              action: { label: "Confirm on People", href: "/dashboard/people" },
            }
          : {
              state: "problem",
              title: "Your app account isn't connected to People yet",
              detail:
                phone.membership === "joined"
                  ? "Add yourself from “In your app, not in People yet”."
                  : "Joining connects you automatically.",
              action:
                phone.membership === "joined"
                  ? { label: "Open People", href: "/dashboard/people" }
                  : undefined,
            };

    const church: Item =
      readiness.problem === "geofence_disabled"
        ? {
            state: "problem",
            title: `Automatic check-in is off for ${churchName}`,
            action: { label: "Turn it on", onClick: () => onOpenStep("live") },
          }
        : readiness.problem === "no_campus_configured"
          ? {
              state: "problem",
              title: `${churchName} isn't on the map for the app`,
              detail: "Phones need a building with a check-in circle.",
              action: { label: "Set the location", onClick: () => onOpenStep("location") },
            }
          : {
              state: "done",
              title: `${churchName} is ready`,
              detail: readiness.watching
                .map((campus) => `${campus.campusName} · ${campus.radiusMeters} m`)
                .join(" · "),
            };

    const consent: Item = phone.consentGranted
      ? { state: "done", title: "Automatic check-in is on in your app" }
      : {
          state: "todo",
          title: "Turn it on in your app",
          detail: "In FaithForm, open Check in and tap “Turn on automatic check-in”.",
        };

    items = [membership, connection, church, consent];
  }

  const report = phone?.appReport ?? null;
  const allReady = items.length > 0 && items.every((item) => item.state === "done");

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 dark:shadow-none">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-accent">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Try it on your phone
          </h2>
          <p className="text-sm text-muted-foreground">
            {allReady
              ? "Everything checks out. Walk into church during a check-in window and you'll be counted."
              : "Checked against your own FaithForm app account, the way the app checks it."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={recheck}
          disabled={refreshing}
          aria-label="Check again"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden />
        </Button>
      </div>

      {phone === null ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Couldn&apos;t check your phone right now. Try again in a moment.
        </p>
      ) : !phone.hasAppAccount ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          You haven&apos;t signed in to the FaithForm app with this account yet.
          Install FaithForm on your phone and sign in with the same email you
          use here — you&apos;ll be added to {churchName} automatically.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.title} className="flex gap-3">
              {item.state === "done" ? (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
              ) : item.state === "problem" ? (
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              ) : (
                <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">
                  {item.title}
                  <span className="sr-only">
                    {item.state === "done" ? " (done)" : item.state === "problem" ? " (needs attention)" : " (to do)"}
                  </span>
                </span>
                {item.detail ? (
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </div>
              {item.action ? (
                item.action.href ? (
                  <Link
                    href={item.action.href}
                    className="shrink-0 self-center text-sm font-semibold text-accent hover:underline"
                  >
                    {item.action.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={item.action.onClick}
                    className="shrink-0 self-center text-sm font-semibold text-accent hover:underline"
                  >
                    {item.action.label}
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {report?.kind === "refused" && !report.isThisChurch ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="text-amber-900 dark:text-amber-100">
            <span className="font-semibold">Your phone may be describing {report.churchName}, not {churchName}.</span>{" "}
            The app checks every church you follow or have joined, and the
            current version reports the first one alphabetically — and{" "}
            {report.churchName} {REASON_PHRASES[report.reason]}. Leave or
            unfollow {report.churchName} in the app, or set it up there too.
          </p>
        </div>
      ) : null}

      {report?.kind === "watching" && phone?.consentGranted ? (
        <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-200">
          Your app is set up to check you in at {report.churchNames.join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
