"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ScanLine, ShieldAlert, UserRound } from "lucide-react";
import { toast } from "sonner";

import {
  completeCheckout,
  lookupCheckoutCredential,
  lookupHouseholdForOverride,
  type CheckoutLookup,
} from "@/app/dashboard/checkin/actions";
import { MedicalNote } from "@/components/checkin/desk-parts";
import { PICKUP_INPUT_LABEL } from "@/components/checkin/copy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { SuccessState } from "@/components/ui/success-state";
import {
  childCount,
  classifyPickupInput,
  joinNames,
  pickupPersonLabel,
  releaseButtonLabel,
} from "@/lib/checkin/desk";
import { cn } from "@/lib/utils";
import { RELATIONSHIP_LABELS } from "@/types/checkin";

/** Who the children are going home with: a listed adult, or someone who isn't. */
type ReleasedTo = { kind: "person"; memberId: string; label: string } | { kind: "unlisted" };

type Released = { count: number; names: string[]; to: string; familyName: string };

/**
 * The desk where a child goes home.
 *
 * A code (typed or scanned) or a name gets you to the same place: this
 * family's children and the adults allowed to take them, and neither releases
 * anybody. The volunteer ticks who is leaving, taps who is taking them, and
 * presses "Release". That second step is the point: the code proves the
 * family, the person at the desk confirms the handover, and both are recorded.
 *
 * A scanner is a keyboard. Most QR readers type the payload and press Enter,
 * so the one box takes both a scan and a typed 6-digit code: no camera, no
 * pairing, nothing to go wrong at 9am.
 *
 * There is no Undo after a release, on purpose: undoing would erase who took
 * the children and why. A child released by mistake who is still here is
 * checked in again from Check in, which keeps both records.
 */
export function CheckoutConsole() {
  const [pending, startTransition] = useTransition();
  const [lookup, setLookup] = useState<CheckoutLookup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releasedTo, setReleasedTo] = useState<ReleasedTo | null>(null);
  const [entry, setEntry] = useState("");
  const [nameSearchOpen, setNameSearchOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideMatches, setOverrideMatches] = useState<CheckoutLookup[] | null>(null);
  const [released, setReleased] = useState<Released | null>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const focusEntryNext = useRef(false);

  useEffect(() => {
    if (!lookup && !released && focusEntryNext.current) {
      focusEntryNext.current = false;
      entryRef.current?.focus();
    }
  }, [lookup, released]);

  function startOver() {
    setLookup(null);
    setSelected(new Set());
    setReleasedTo(null);
    setOverrideMode(false);
    setOverrideReason("");
    setOverrideMatches(null);
    setOverrideSearch("");
    setNameSearchOpen(false);
    setReleased(null);
    setEntry("");
    focusEntryNext.current = true;
  }

  function openFamily(found: CheckoutLookup) {
    setLookup(found);
    setSelected(new Set(found.sessions.map((s) => s.id)));
    // Never pre-chosen: the volunteer taps the person actually standing there.
    setReleasedTo(null);
    setOverrideReason("");
    setEntry("");
  }

  function runOverrideSearch() {
    startTransition(async () => {
      const result = await lookupHouseholdForOverride(overrideSearch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOverrideMatches(result.data);
    });
  }

  // Anything reached by name is released without a code by construction:
  // there was no code, so the reason box is open before the desk can release.
  function chooseOverrideHousehold(match: CheckoutLookup) {
    openFamily(match);
    setOverrideMode(true);
    setOverrideMatches(null);
    setOverrideSearch("");
    setNameSearchOpen(false);
  }

  function runLookup(raw: string) {
    const parsed = classifyPickupInput(raw);
    if (!parsed) {
      toast.error("Type all six numbers of the code, or scan the QR code again.");
      return;
    }

    startTransition(async () => {
      const result = await lookupCheckoutCredential({ kind: parsed.kind, value: parsed.value });
      if (!result.ok) {
        toast.error(result.error);
        setEntry("");
        entryRef.current?.focus();
        return;
      }
      openFamily(result.data);
      setOverrideMode(false);
    });
  }

  function toggle(sessionId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function chooseUnlisted() {
    // Someone the family hasn't listed may only take a child with a written
    // reason, flagged for review: the same rule as releasing without a code.
    setReleasedTo({ kind: "unlisted" });
    setOverrideMode(true);
  }

  function handleRelease() {
    if (!lookup || !releasedTo) return;
    if (selected.size === 0) {
      toast.error("Tick who is going home.");
      return;
    }

    const names = lookup.sessions
      .filter((session) => selected.has(session.id))
      .map((session) => session.firstName);
    const to = releasedTo.kind === "person" ? releasedTo.label : "someone not on the family's list";

    startTransition(async () => {
      const result = await completeCheckout({
        sessionIds: Array.from(selected),
        method: overrideMode ? "override" : lookup.method,
        releasedToMemberId: releasedTo.kind === "person" ? releasedTo.memberId : undefined,
        overrideReason: overrideMode ? overrideReason : undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setReleased({
        count: result.data.released,
        names,
        to,
        familyName: lookup.householdName,
      });
      setLookup(null);
      setSelected(new Set());
    });
  }

  if (released) {
    return (
      <SuccessState
        className="py-14"
        title={`${childCount(released.count)} released`}
        description={`${joinNames(released.names)} went home with ${released.to}.`}
        actions={
          <Button type="button" size="lg" className="min-h-14 text-lg" onClick={startOver}>
            Pick up another family
          </Button>
        }
      >
        <p className="max-w-md text-[15px] text-muted-foreground">
          Released the wrong child? If they are still here, check them in again
          from{" "}
          <Link href="/dashboard/checkin" className="font-semibold text-primary underline underline-offset-4 dark:text-accent">
            Check in
          </Link>
          . The record of this pick-up is kept.
        </p>
      </SuccessState>
    );
  }

  if (lookup) {
    const pickupPeople = [
      ...lookup.guardians.map((person) => ({
        ...person,
        text: pickupPersonLabel(person.name, person.label, RELATIONSHIP_LABELS.guardian),
      })),
      ...lookup.authorizedPickups.map((person) => ({
        ...person,
        text: pickupPersonLabel(person.name, person.label, "allowed to pick up"),
      })),
    ];
    const reasonMissing = overrideMode && overrideReason.trim().length < 4;
    const noCode = lookup.method === "override";

    return (
      <Card className="flex flex-col gap-8 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-heading text-2xl font-bold text-foreground">
              {lookup.householdName}
            </h2>
            <p className="text-[15px] text-muted-foreground">
              {noCode
                ? "Found by name. No code was shown."
                : lookup.method === "qr"
                  ? "Found with the QR code."
                  : "Found with this week's code."}
            </p>
          </div>
          {overrideMode ? (
            <StatusBadge tone="attention" size="lg">
              Release without a code
            </StatusBadge>
          ) : (
            <StatusBadge tone="done" size="lg">
              Code is correct
            </StatusBadge>
          )}
        </div>

        {lookup.sessions.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-base text-foreground">
              None of this family&rsquo;s children are checked in right now.
            </p>
            <Button type="button" size="lg" variant="outline" onClick={startOver}>
              Start again
            </Button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-lg font-semibold text-foreground">
                Who is going home?
              </legend>
              {lookup.sessions.map((session) => {
                const on = selected.has(session.id);
                return (
                  <div
                    key={session.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-2xl border-2 p-4 transition-colors motion-reduce:transition-none",
                      on ? "border-accent bg-accent/[0.08]" : "border-border bg-background",
                    )}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(session.id)}
                      className="flex min-h-14 items-center gap-4 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg border-2",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/50 bg-background",
                        )}
                      >
                        {on && <Check className="size-6" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold text-foreground">
                          {session.firstName} {session.lastName}
                        </span>
                        <span className="block text-[15px] text-muted-foreground">
                          {session.locationName}
                          {session.status === "pre_checked_in" &&
                            " · marked on the way, never arrived"}
                        </span>
                      </span>
                    </button>
                    <MedicalNote note={session.medicalNotes} />
                  </div>
                );
              })}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-lg font-semibold text-foreground">
                Who is picking them up?
              </legend>
              <p className="mb-2 text-[15px] text-muted-foreground">
                Tap the person standing in front of you.
              </p>
              <div role="radiogroup" aria-label="Who is picking them up" className="choice-grid">
                {pickupPeople.map((person) => {
                  const chosen =
                    releasedTo?.kind === "person" && releasedTo.memberId === person.memberId;
                  return (
                    <button
                      key={person.memberId}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() =>
                        setReleasedTo({ kind: "person", memberId: person.memberId, label: person.text })
                      }
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                        chosen
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:border-accent",
                      )}
                    >
                      <UserRound className="size-6 shrink-0" aria-hidden />
                      <span>Released to {person.text}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={releasedTo?.kind === "unlisted"}
                  onClick={chooseUnlisted}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 text-left text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    releasedTo?.kind === "unlisted"
                      ? "border-orange-500 bg-orange-50 text-orange-950 dark:bg-orange-500/15 dark:text-orange-100"
                      : "border-border bg-background text-foreground hover:border-accent",
                  )}
                >
                  <ShieldAlert className="size-6 shrink-0" aria-hidden />
                  <span>Someone not on this list</span>
                </button>
              </div>
              {pickupPeople.length === 0 && (
                <p className="text-[15px] text-muted-foreground">
                  This family has no parents or pickup people listed yet. A church
                  admin can add them in People › Families.
                </p>
              )}
            </fieldset>

            {overrideMode && (
              <div className="flex flex-col gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 p-5 dark:border-orange-500/40 dark:bg-orange-500/10">
                <Label htmlFor="override-reason" className="flex items-center gap-2 text-base font-semibold">
                  <ShieldAlert className="size-5" aria-hidden />
                  Why are you releasing without a code?
                </Label>
                <Input
                  id="override-reason"
                  value={overrideReason}
                  autoFocus
                  placeholder="Checked driver's licence: Sarah Doe, mother"
                  onChange={(event) => setOverrideReason(event.target.value)}
                  className="min-h-12 text-base"
                />
                <p className="text-[15px] text-orange-950 dark:text-orange-100">
                  Write which ID you checked or who confirmed it. This is saved
                  with your name and flagged for a church admin to review.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button
                type="button"
                size="lg"
                className="min-h-14 w-full text-lg"
                disabled={pending || selected.size === 0 || !releasedTo || reasonMissing}
                onClick={handleRelease}
              >
                {pending ? "Releasing…" : releaseButtonLabel(selected.size)}
              </Button>
              {!releasedTo && selected.size > 0 && (
                <p className="text-center text-[15px] text-muted-foreground">
                  Tap who is picking them up first.
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                {!noCode && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (overrideMode) {
                        setOverrideMode(false);
                        if (releasedTo?.kind === "unlisted") setReleasedTo(null);
                      } else {
                        setOverrideMode(true);
                      }
                    }}
                  >
                    {overrideMode ? "Use the code instead" : "Release without a code"}
                  </Button>
                )}
                <Button type="button" variant="ghost" onClick={startOver}>
                  Start again
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6 sm:p-8">
        <Label htmlFor="pickup-entry" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ScanLine className="size-6" aria-hidden />
          {PICKUP_INPUT_LABEL}
        </Label>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            runLookup(entry);
          }}
        >
          <input
            ref={entryRef}
            id="pickup-entry"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={entry}
            placeholder="123 456"
            disabled={pending}
            onChange={(event) => setEntry(event.target.value)}
            className="flex min-h-16 w-full flex-1 rounded-2xl border-2 border-border bg-background px-5 py-4 font-mono text-2xl tracking-[0.15em] shadow-sm placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
          />
          <Button type="submit" size="lg" className="min-h-16" disabled={pending || !entry.trim()}>
            {pending ? "Finding…" : "Find family"}
          </Button>
        </form>
        <p className="text-[15px] text-muted-foreground">
          A handheld scanner fills this in for you. Codes change every week, so
          last week&rsquo;s code won&rsquo;t work.
        </p>
      </Card>

      <Card className="flex flex-col gap-4 p-6 sm:p-8">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold text-foreground">No phone, no code?</h2>
          <p className="text-[15px] text-muted-foreground">
            Find the family by name, check the adult&rsquo;s ID yourself, and
            write down what you checked. Every release like this is flagged for
            review.
          </p>
        </div>

        {!nameSearchOpen ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="self-start"
            onClick={() => setNameSearchOpen(true)}
          >
            <ShieldAlert aria-hidden />
            Release without a code
          </Button>
        ) : (
          <>
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                runOverrideSearch();
              }}
            >
              <Label htmlFor="override-search" className="sr-only">
                Family or child&rsquo;s name
              </Label>
              <Input
                id="override-search"
                autoFocus
                value={overrideSearch}
                placeholder="Family or child's name"
                disabled={pending}
                onChange={(event) => setOverrideSearch(event.target.value)}
                className="min-h-12 text-base"
              />
              <Button
                type="submit"
                size="lg"
                variant="outline"
                disabled={pending || overrideSearch.trim().length < 2}
              >
                Search
              </Button>
            </form>

            {overrideMatches && overrideMatches.length === 0 && (
              <p className="text-[15px] text-muted-foreground">
                No checked-in children match that name.
              </p>
            )}

            {overrideMatches && overrideMatches.length > 0 && (
              <ul className="flex flex-col gap-2">
                {overrideMatches.map((match) => (
                  <li key={match.householdId}>
                    <button
                      type="button"
                      onClick={() => chooseOverrideHousehold(match)}
                      className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-border bg-background px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    >
                      <span className="text-base font-semibold text-foreground">
                        {match.householdName}
                      </span>
                      <span className="text-[15px] text-muted-foreground">
                        {joinNames(match.sessions.map((session) => session.firstName))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
