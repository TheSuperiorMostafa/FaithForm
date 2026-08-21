"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Apple, ExternalLink } from "lucide-react";

import {
  connectAppleCalendarAction,
  listAppleCalendarsAction,
} from "@/app/dashboard/settings/apple-calendar-actions";
import type { AppleCalendarChoice } from "@/lib/integrations/apple-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AppleCalendarStatus = {
  connected: boolean;
  appleId: string | null;
  calendarName: string | null;
  needsReconnect: boolean;
  reconnectReason: string | null;
};

/**
 * Connecting iCloud Calendar, in the church's own words.
 *
 * Apple has no "Connect with Apple" button to offer for calendar data, so this
 * has to explain the app-specific password rather than hide it — a church that
 * types its ordinary Apple ID password gets a rejection with no idea why.
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
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [calendars, setCalendars] = useState<AppleCalendarChoice[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setOpen(false);
    setAppleId("");
    setAppPassword("");
    setCalendars(null);
    setChosen(null);
    setError(null);
  }

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
      reset();
      window.location.href = "/dashboard/settings?tab=integrations&apple_connected=1";
    });
  }

  const detail = status.connected
    ? `${status.appleId ?? "Connected"} · calendar: ${status.calendarName ?? "iCloud"}`
    : "Not connected";

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
                onClick={() => setOpen((value) => !value)}
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
            <Button size="sm" type="button" onClick={() => setOpen((value) => !value)}>
              {status.needsReconnect ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
          <p className="text-sm text-muted-foreground">
            Apple does not offer a sign-in button for calendars, so iCloud needs
            an <strong className="font-semibold text-foreground">app-specific
            password</strong> — a one-off password just for FaithForm, which you
            can revoke any time without changing your Apple ID password.{" "}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="apple_id">Apple ID</Label>
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
              <Label>Which calendar holds church events?</Label>
              <div className="flex flex-col gap-2">
                {calendars.map((calendar) => {
                  const active = chosen === calendar.url;
                  return (
                    <button
                      key={calendar.url}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChosen(calendar.url)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-accent/60 bg-accent/10 shadow-sm"
                          : "border-border bg-background hover:border-accent/40 hover:bg-accent/5",
                      )}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        {calendar.name}
                      </span>
                      {!calendar.writable && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Read-only — events show up here, but new ones have to
                          be added in Apple Calendar.
                        </span>
                      )}
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
                {pending ? "Connecting…" : "Connect this calendar"}
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
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
