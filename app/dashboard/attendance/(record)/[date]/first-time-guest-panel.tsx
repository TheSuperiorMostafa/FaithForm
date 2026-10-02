"use client";

import { useMemo, useState, useTransition } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import {
  notifyPastorOfFirstTimeGuests,
  sendWelcomeTextsToGuests,
} from "./actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  defaultPastorMessage,
  defaultWelcomeMessage,
  guestDisplayName,
  personalizeWelcomeMessage,
  validatePastorMessage,
  validateWelcomeMessage,
  type FirstTimeGuest,
} from "@/lib/attendance/first-time-guests";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type FirstTimeGuestPanelProps = {
  serviceDate: string;
  guests: FirstTimeGuest[];
  /** Shown in the welcome preview and default message. */
  churchName: string;
};

type Mode = "idle" | "pastor" | "welcome";

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function texts(n: number) {
  return `${n} ${n === 1 ? "text" : "texts"}`;
}

/**
 * After a Sunday is saved (or on the summary), list first-time guests and
 * offer "Tell pastor" / "Send welcome" using the church's own texting phone.
 */
export function FirstTimeGuestPanel({
  serviceDate,
  guests,
  churchName,
}: FirstTimeGuestPanelProps) {
  const dayLabel = formatServiceDate(serviceDate);
  const withPhone = useMemo(
    () => guests.filter((guest) => Boolean(guest.phone?.trim())),
    [guests],
  );

  const [mode, setMode] = useState<Mode>("idle");
  const [pastorMessage, setPastorMessage] = useState(() =>
    defaultPastorMessage(dayLabel, guests),
  );
  const [welcomeMessage, setWelcomeMessage] = useState(() =>
    defaultWelcomeMessage(churchName),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(withPhone.map((guest) => guest.memberId)),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();

  if (guests.length === 0) return null;

  const pastorCheck = validatePastorMessage(pastorMessage);
  const welcomeCheck = validateWelcomeMessage(welcomeMessage);
  const chosenWelcome = withPhone.filter((guest) => selected.has(guest.memberId));
  const sample = chosenWelcome[0] ?? withPhone[0] ?? null;

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function sendPastor() {
    setError(null);
    if (!pastorCheck.ok) {
      setError(pastorCheck.error);
      return;
    }
    const ok = await confirmAction({
      title: "Text the pastor now?",
      description:
        "Sends one text to your church phone (the number in Settings), or to your church's texting phone if Settings has no number. A text can't be taken back once it's sent.",
      confirmLabel: "Tell pastor",
      destructive: true,
    });
    if (!ok) return;

    startSending(async () => {
      try {
        const result = await notifyPastorOfFirstTimeGuests({
          serviceDate,
          memberIds: guests.map((guest) => guest.memberId),
          message: pastorCheck.message,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const where =
          result.pastorDestination === "texting_phone"
            ? "your church's texting phone"
            : "your church phone";
        toast.success(`Told the pastor about ${people(guests.length)} at ${where}.`);
        setMode("idle");
      } catch {
        setError("We couldn't send the text. Check your connection and try again.");
      }
    });
  }

  async function sendWelcome() {
    setError(null);
    if (!welcomeCheck.ok) {
      setError(welcomeCheck.error);
      return;
    }
    const count = chosenWelcome.length;
    if (count === 0) {
      setError("Choose at least one guest who has a phone number.");
      return;
    }
    const ok = await confirmAction({
      title: `Send welcome to ${people(count)}?`,
      description:
        "Each guest gets the message shown, with their own first name. A text can't be taken back once it's sent.",
      confirmLabel: `Send ${texts(count)}`,
      destructive: true,
    });
    if (!ok) return;

    startSending(async () => {
      try {
        const result = await sendWelcomeTextsToGuests({
          serviceDate,
          memberIds: chosenWelcome.map((guest) => guest.memberId),
          message: welcomeCheck.message,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.failed > 0) {
          toast.warning(
            `Texted ${people(result.sent)}. ${people(result.failed)} couldn't be texted.`,
          );
        } else {
          toast.success(`Sent ${texts(result.sent)} welcoming first-time guests.`);
        }
        setMode("idle");
      } catch {
        setError("We couldn't send the texts. Check your connection and try again.");
      }
    });
  }

  return (
    <section
      className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-card dark:shadow-none"
      aria-labelledby="first-time-guests-heading"
    >
      <div className="flex flex-col gap-1">
        <h3
          id="first-time-guests-heading"
          className="font-heading text-lg font-semibold text-foreground"
        >
          {guests.length === 1 ? "1 first-time guest" : `${guests.length} first-time guests`}
        </h3>
        <p className="text-[15px] text-muted-foreground">
          Tell the pastor, or send a welcome text to guests who left a phone number.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {guests.map((guest) => (
          <li
            key={guest.memberId}
            className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-2"
          >
            <span className="text-base font-medium text-foreground">
              {guestDisplayName(guest)}
            </span>
            <span className="text-sm text-muted-foreground">
              {guest.phone?.trim() ? guest.phone : "No phone"}
            </span>
          </li>
        ))}
      </ul>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="lg" onClick={() => setMode("pastor")}>
            <MessageSquare aria-hidden />
            Tell pastor
          </Button>
          {withPhone.length > 0 ? (
            <Button type="button" size="lg" variant="outline" onClick={() => setMode("welcome")}>
              <Send aria-hidden />
              Send welcome
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "pastor" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pastor-guest-message" className="text-base font-semibold">
              Message to the pastor
            </Label>
            <p className="text-[15px] text-muted-foreground">
              Goes to your church phone in Settings. If that&apos;s empty, it goes to
              your church&apos;s texting phone instead.
            </p>
            <Textarea
              id="pastor-guest-message"
              value={pastorMessage}
              onChange={(event) => setPastorMessage(event.target.value)}
              rows={6}
              className="resize-y text-base"
            />
          </div>
          {error ? (
            <p className="text-base text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              disabled={isSending || !pastorCheck.ok}
              onClick={() => void sendPastor()}
            >
              {isSending ? "Sending…" : "Tell pastor"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={isSending}
              onClick={() => {
                setError(null);
                setMode("idle");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "welcome" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label className="text-base font-semibold">Who gets a welcome text</Label>
            <ul className="flex flex-col gap-2">
              {withPhone.map((guest) => {
                const checked = selected.has(guest.memberId);
                return (
                  <li key={guest.memberId}>
                    <label
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2",
                        checked ? "border-accent bg-accent/[0.06]" : "border-border",
                      )}
                    >
                      <Checkbox.Root
                        checked={checked}
                        onCheckedChange={() => toggle(guest.memberId)}
                        aria-label={`Welcome ${guestDisplayName(guest)}`}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border-2 border-input bg-background data-[checked]:border-accent data-[checked]:bg-accent"
                      >
                        <Checkbox.Indicator className="text-accent-foreground">
                          <Check className="size-5" strokeWidth={2} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span className="text-base font-medium text-foreground">
                        {guestDisplayName(guest)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="welcome-guest-message" className="text-base font-semibold">
              Welcome message
            </Label>
            <p className="text-[15px] text-muted-foreground">
              Include [Name] where each first name goes. You can also use [Church].
            </p>
            <Textarea
              id="welcome-guest-message"
              value={welcomeMessage}
              onChange={(event) => setWelcomeMessage(event.target.value)}
              rows={4}
              className="resize-y text-base"
            />
            {sample && welcomeCheck.ok ? (
              <p className="rounded-xl bg-muted/60 px-4 py-3 text-[15px] text-foreground">
                Preview:{" "}
                {personalizeWelcomeMessage(
                  welcomeCheck.message,
                  sample.firstName,
                  churchName,
                )}
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="text-base text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              disabled={isSending || !welcomeCheck.ok || chosenWelcome.length === 0}
              onClick={() => void sendWelcome()}
            >
              {isSending ? "Sending…" : `Send welcome (${chosenWelcome.length})`}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={isSending}
              onClick={() => {
                setError(null);
                setMode("idle");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
