"use client";

import { useState, useTransition, type TransitionStartFunction } from "react";
import { AlertTriangle, Apple, Check, ExternalLink, Info } from "lucide-react";

import {
  connectAppleCalendarAction,
  connectAppleCalendarLinkAction,
  configureICloudMailAction,
  listAppleCalendarsAction,
} from "@/app/dashboard/settings/apple-calendar-actions";
import type { AppleCalendarChoice } from "@/lib/integrations/apple-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type AppleCalendarStatus = {
  connected: boolean;
  appleId: string | null;
  calendarName: string | null;
  /** Connected through a public link, so FaithForm can read but not write. */
  readOnly: boolean;
  needsReconnect: boolean;
  reconnectReason: string | null;
  mailAddress: string | null;
  mailEnabled: boolean;
  mailVerifiedAt: string | null;
};

/**
 * Connecting iCloud Calendar, in the church's own words.
 *
 * The main way in is the calendar's own public link: turn on Public Calendar
 * in Apple Calendar, copy the link, paste it here. No Apple ID and no
 * password, which is the only way a pastor will actually do it. The cost is
 * that FaithForm can only read that calendar.
 *
 * The Apple ID and app-specific password route stays for a church that wants
 * FaithForm to edit its iCloud events too, one click further down.
 */
export function AppleCalendarConnect({
  status,
  onDisconnect,
  disconnectDisabled,
}: {
  status: AppleCalendarStatus;
  onDisconnect: () => void;
  disconnectDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mailAddress, setMailAddress] = useState(status.mailAddress ?? "");
  const [mailEnabled, setMailEnabled] = useState(status.mailEnabled);

  function close() {
    setOpen(false);
    setAdvanced(false);
    setError(null);
  }

  function connected() {
    close();
    window.location.href = "/dashboard/settings?tab=integrations&apple_connected=1";
  }

  function configureMail(enabled: boolean) {
    setError(null);
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("mailAddress", mailAddress);
    startTransition(async () => {
      const result = await configureICloudMailAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMailEnabled(enabled);
      setError(null);
    });
  }

  const detail = !status.connected
    ? "Not connected"
    : status.readOnly
      ? `${status.calendarName ?? "iCloud calendar"} · read-only link`
      : `${status.appleId ?? "Connected"} · calendar: ${status.calendarName ?? "iCloud"}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/45 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Apple className="size-5" strokeWidth={1.75} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">iCloud Calendar</p>
              <Badge
                variant={
                  status.connected
                    ? "default"
                    : status.needsReconnect
                      ? "destructive"
                      : "secondary"
                }
              >
                {status.connected
                  ? "Connected"
                  : status.needsReconnect
                    ? "Reconnect needed"
                    : "Not connected"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{detail}</p>
            {!status.connected && status.needsReconnect && status.reconnectReason && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span>{status.reconnectReason}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {status.connected ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (open ? close() : setOpen(true))}
              >
                Change calendar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={disconnectDisabled}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              type="button"
              onClick={() => (open ? close() : setOpen(true))}
            >
              {status.needsReconnect ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
          {advanced ? (
            <AppleIdForm
              pending={pending}
              startTransition={startTransition}
              error={error}
              setError={setError}
              onConnected={connected}
              onCancel={close}
              onBack={() => {
                setAdvanced(false);
                setError(null);
              }}
            />
          ) : (
            <CalendarLinkForm
              pending={pending}
              startTransition={startTransition}
              error={error}
              setError={setError}
              onConnected={connected}
              onCancel={close}
              onAdvanced={() => {
                setAdvanced(true);
                setError(null);
              }}
            />
          )}
        </div>
      )}

      {status.connected && !status.readOnly && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Apple Mail drafts</p>
            <p className="text-sm text-muted-foreground">
              Use the same app-specific password to create weekly announcement drafts in iCloud Mail.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="icloud_mail_address">iCloud Mail address</Label>
              <Input
                id="icloud_mail_address"
                type="email"
                placeholder="yourchurch@icloud.com"
                value={mailAddress}
                onChange={(event) => setMailAddress(event.target.value)}
                disabled={pending || mailEnabled}
              />
            </div>
            <Button
              type="button"
              variant={mailEnabled ? "outline" : "default"}
              onClick={() => configureMail(!mailEnabled)}
              disabled={pending || (!mailEnabled && !mailAddress.trim())}
            >
              {pending ? "Checking…" : mailEnabled ? "Turn off drafts" : "Enable drafts"}
            </Button>
          </div>
          {mailEnabled && (
            <p className="text-xs text-green-700 dark:text-green-300">
              Weekly announcements will be created as drafts in Apple Mail.
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

type FormProps = {
  pending: boolean;
  startTransition: TransitionStartFunction;
  error: string | null;
  setError: (error: string | null) => void;
  onConnected: () => void;
  onCancel: () => void;
};

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground marker:text-muted-foreground">
      {children}
    </ol>
  );
}

/** The no-password way in: paste the calendar's public link. */
function CalendarLinkForm({
  pending,
  startTransition,
  error,
  setError,
  onConnected,
  onCancel,
  onAdvanced,
}: FormProps & { onAdvanced: () => void }) {
  const [link, setLink] = useState("");

  function connect() {
    setError(null);
    const formData = new FormData();
    formData.set("calendarLink", link);

    startTransition(async () => {
      const result = await connectAppleCalendarLinkAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onConnected();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Paste your iCloud calendar link
        </p>
        <p className="text-sm text-muted-foreground">
          No Apple ID or password needed. Apple Calendar gives every calendar a
          link you can share, and FaithForm reads your church events from it.
        </p>
      </div>

      <Tabs defaultValue="iphone" className="flex flex-col gap-3">
        <TabsList className="self-start">
          <TabsTrigger value="iphone">iPhone or iPad</TabsTrigger>
          <TabsTrigger value="mac">Mac</TabsTrigger>
          <TabsTrigger value="web">iCloud.com</TabsTrigger>
        </TabsList>

        <TabsContent value="iphone">
          <Steps>
            <li>
              Open the <strong className="font-semibold">Calendar</strong> app
              and tap <strong className="font-semibold">Calendars</strong> at the
              bottom of the screen.
            </li>
            <li>
              Tap the <Info className="inline size-3.5 align-[-2px]" aria-label="info" />{" "}
              button next to your church calendar.
            </li>
            <li>
              Scroll down, turn on{" "}
              <strong className="font-semibold">Public Calendar</strong>, then tap{" "}
              <strong className="font-semibold">Share Link</strong> and choose{" "}
              <strong className="font-semibold">Copy</strong>.
            </li>
            <li>Paste it in the box below.</li>
          </Steps>
        </TabsContent>

        <TabsContent value="mac">
          <Steps>
            <li>
              Open the <strong className="font-semibold">Calendar</strong> app and
              hold the pointer over your church calendar in the list on the left.
            </li>
            <li>
              Click the share button that appears beside it, then tick{" "}
              <strong className="font-semibold">Public Calendar</strong>.
            </li>
            <li>
              A link appears under it. Use the share button next to the link to
              copy it, or send it to yourself.
            </li>
            <li>Paste it in the box below.</li>
          </Steps>
        </TabsContent>

        <TabsContent value="web">
          <Steps>
            <li>
              Go to{" "}
              <a
                href="https://www.icloud.com/calendar/"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                icloud.com/calendar
                <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
              </a>{" "}
              and sign in.
            </li>
            <li>
              Hold the pointer over your church calendar in the sidebar and click
              the <Info className="inline size-3.5 align-[-2px]" aria-label="info" />{" "}
              button.
            </li>
            <li>
              Turn on <strong className="font-semibold">Public Calendar</strong>,
              then click <strong className="font-semibold">Copy</strong>.
            </li>
            <li>Paste it in the box below.</li>
          </Steps>
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apple_calendar_link">Calendar link</Label>
        <Input
          id="apple_calendar_link"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="webcal://p00-caldav.icloud.com/published/2/..."
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>
            Anyone with this link can see the calendar, so use one that only
            holds church events.
          </li>
          <li>
            FaithForm can show these events but not change them. Add or edit
            events in Apple Calendar; changes can take a few minutes to appear.
          </li>
        </ul>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={connect} disabled={pending || !link.trim()}>
          {pending ? "Checking the link…" : "Connect calendar"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <button
        type="button"
        onClick={onAdvanced}
        className="self-start text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Want FaithForm to change your iCloud events too? Connect with an Apple ID
        instead.
      </button>
    </>
  );
}

/**
 * The Apple ID route, for a church that wants two-way sync.
 *
 * Apple has no sign-in button for calendar data, so this has to explain the
 * app-specific password rather than hide it: a church that types its ordinary
 * Apple ID password gets a rejection with no idea why.
 */
function AppleIdForm({
  pending,
  startTransition,
  error,
  setError,
  onConnected,
  onCancel,
  onBack,
}: FormProps & { onBack: () => void }) {
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [calendars, setCalendars] = useState<AppleCalendarChoice[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  function findCalendars() {
    setError(null);
    const formData = new FormData();
    formData.set("appleId", appleId);
    formData.set("appPassword", appPassword);

    startTransition(async () => {
      const result = await listAppleCalendarsAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCalendars(result.calendars);
      setChosen(
        result.calendars.find((calendar) => calendar.writable)?.url ??
          result.calendars[0]?.url ??
          null,
      );
    });
  }

  const chosenName =
    calendars?.find((calendar) => calendar.url === chosen)?.name ?? null;

  function connect() {
    if (!chosen) return;
    setError(null);
    const calendar = calendars?.find((entry) => entry.url === chosen);
    const formData = new FormData();
    formData.set("appleId", appleId);
    formData.set("appPassword", appPassword);
    formData.set("calendarUrl", chosen);
    formData.set("calendarName", calendar?.name ?? "");

    startTransition(async () => {
      const result = await connectAppleCalendarAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onConnected();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Connect with an Apple ID
        </p>
        <p className="text-sm text-muted-foreground">
          This lets FaithForm change your iCloud events as well as read them.
          Apple does not offer a sign-in button for calendars, so it needs an{" "}
          <strong className="font-semibold text-foreground">
            app-specific password
          </strong>
          : a separate password just for FaithForm, which you can delete any
          time without changing your Apple ID password.{" "}
          <a
            href="https://account.apple.com/account/manage"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
          >
            Create one at account.apple.com
            <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
          </a>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="apple_id">Apple ID email</Label>
          <Input
            id="apple_id"
            type="email"
            autoComplete="off"
            placeholder="office@yourchurch.org"
            value={appleId}
            onChange={(event) => setAppleId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="apple_app_password">App-specific password</Label>
          <Input
            id="apple_app_password"
            type="password"
            autoComplete="off"
            placeholder="abcd-efgh-ijkl-mnop"
            value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)}
          />
        </div>
      </div>

      {calendars && (
        <div className="flex flex-col gap-2">
          <Label id="apple_calendar_choice">
            Which calendar holds church events?
          </Label>
          <div
            role="radiogroup"
            aria-labelledby="apple_calendar_choice"
            className="flex flex-col gap-2"
          >
            {calendars.map((calendar) => {
              const active = chosen === calendar.url;
              return (
                <button
                  key={calendar.url}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(calendar.url)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "border-accent bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] shadow-sm ring-2 ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]"
                      : "border-border bg-background hover:bg-muted/60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      active
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-muted-foreground/40 bg-background",
                    )}
                  >
                    {active && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="block text-sm font-semibold text-foreground">
                        {calendar.name}
                      </span>
                      {active && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                          Selected
                        </span>
                      )}
                    </span>
                    {!calendar.writable && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Read-only. Events show up here, but new ones have to be
                        added in Apple Calendar.
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {calendars ? (
          <Button type="button" onClick={connect} disabled={pending || !chosen}>
            {pending
              ? "Connecting…"
              : chosenName
                ? `Connect “${chosenName}”`
                : "Connect this calendar"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={findCalendars}
            disabled={pending || !appleId || !appPassword}
          >
            {pending ? "Checking with Apple…" : "Find my calendars"}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Use a calendar link instead, no password needed.
      </button>
    </>
  );
}
