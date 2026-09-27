"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  endKiosk,
  getCheckinDisplayState,
  listKiosks,
  refreshDisplayPairing,
  startCheckinDisplay,
  startKiosk,
  stopCheckinDisplay,
  type CheckinDisplayState,
  type KioskSummary,
} from "@/app/dashboard/attendance/services/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * Where a pastor starts the check-in display and the welcome desk.
 *
 * ## The pairing code is the whole design
 *
 * A staff member never carries a dashboard session to the projector. They start
 * the display here, on their own signed-in machine, and read a seven-character
 * code across the room. The projector types it and receives a capability that
 * can read one service's rotating code and nothing else.
 *
 * That is why the code is shown **once**, large, with an explicit note that it
 * is short-lived — and why "Show another code" exists rather than the code being
 * kept on screen. A code left on a dashboard is a code on a laptop somebody
 * walks away from.
 *
 * ## Why stopping is separate from cancelling
 *
 * Stopping the display stops new check-ins. It does not touch anyone already
 * counted, because a counted fact is independent of the code that produced it.
 * Cancelling a service is a different, louder action and lives elsewhere.
 */
export function CheckinDisplayPanel({
  occurrenceId,
  isAdmin,
  appEnabled,
}: {
  occurrenceId: string;
  isAdmin: boolean;
  /** The church's FaithForm app is switched on; off hides the code screen. */
  appEnabled: boolean;
}) {
  const [state, setState] = useState<CheckinDisplayState | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [kiosks, setKiosks] = useState<KioskSummary[]>([]);
  const [kioskCode, setKioskCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshRequestId = useRef(0);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    const requestId = ++refreshRequestId.current;
    startTransition(async () => {
      const [display, desks] = await Promise.all([
        getCheckinDisplayState(occurrenceId),
        listKiosks(occurrenceId),
      ]);
      if (requestId !== refreshRequestId.current) return;
      if (display.ok) setState(display.data);
      if (desks.ok) setKiosks(desks.data);
      setLoadError(
        [!display.ok ? display.message : null, !desks.ok ? desks.message : null]
          .filter(Boolean)
          .join(" ") || null,
      );
    });
  }, [occurrenceId]);

  useEffect(() => {
    // A new service is selected: forget the previous one's codes rather than
    // leaving a live pairing code on screen under the wrong heading.
    setState(null);
    setKiosks([]);
    setLoadError(null);
    setPairing(null);
    setKioskCode(null);
    refresh();
    return () => {
      refreshRequestId.current += 1;
    };
  }, [occurrenceId, refresh]);

  const awaitingKioskPairing = kiosks.some((kiosk) => kiosk.status === "pending");
  useEffect(() => {
    if (!kioskCode || !awaitingKioskPairing) return;

    // The administrator is reading the one-use code to a tablet. Update the
    // status when it connects, then stop polling after the setup window.
    const interval = window.setInterval(refresh, 10_000);
    const stop = window.setTimeout(() => window.clearInterval(interval), 120_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [awaitingKioskPairing, kioskCode, refresh]);

  if (state && !state.signingConfigured && !loadError) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-[15px] text-muted-foreground">
        Check-in codes aren&rsquo;t available yet. Contact FaithForm support to
        turn them on for your church.
      </div>
    );
  }

  const running = Boolean(state?.sessionId);
  const controlsUnavailable = pending || !state || Boolean(loadError);

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <span>{loadError}</span>
          <Button variant="outline" onClick={refresh} disabled={pending}>
            Try again
          </Button>
        </div>
      ) : null}
      {/* The screen's code is scanned in the FaithForm app, so it goes with the app. */}
      {appEnabled ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">Check-in screen</span>
            {running ? <StatusBadge tone="live">On</StatusBadge> : null}

            {running ? (
              <>
                <Button
              
                  variant="outline"
                  disabled={controlsUnavailable}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await refreshDisplayPairing({ occurrenceId });
                      if (result.ok) {
                        setPairing({
                          code: result.data.pairingCode,
                          expiresAt: result.data.pairingExpiresAt,
                        });
                      } else toast.error(result.message);
                    })
                  }
                >
                  Show another code
                </Button>
                <Button
              
                  variant="outline"
                  disabled={controlsUnavailable}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await stopCheckinDisplay({ sessionId: state!.sessionId! });
                      if (result.ok) {
                        setPairing(null);
                        toast.success("Check-in screen turned off. Nobody already counted was affected.");
                        refresh();
                      } else toast.error(result.message);
                    })
                  }
                >
                  Turn off the screen
                </Button>
              </>
            ) : (
              <Button
            
                disabled={controlsUnavailable}
                onClick={() =>
                  startTransition(async () => {
                    const result = await startCheckinDisplay({ occurrenceId });
                    if (result.ok) {
                      setPairing({
                        code: result.data.pairingCode,
                        expiresAt: result.data.pairingExpiresAt,
                      });
                      refresh();
                    } else toast.error(result.message);
                  })
                }
              >
                Show a check-in code on a screen
              </Button>
            )}
          </div>

          {state && !state.qrEnabled ? (
            <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Scanning a code is turned off for this service, so phones will be told
              this kind of check-in isn&rsquo;t on. Turn on &ldquo;Scan a code&rdquo;
              in{" "}
              <Link href="/dashboard/attendance/setup" className="font-semibold underline">
                Setup
              </Link>
              . It applies to services whose check-in hasn&rsquo;t opened yet.
            </p>
          ) : null}

          {pairing ? (
            <PairingCallout
              code={pairing.code}
              expiresAt={pairing.expiresAt}
              path="/checkin/display"
              instruction="On the computer connected to the screen, open this address and type the code."
              onDone={() => setPairing(null)}
            />
          ) : null}

          {running ? (
            <p className="text-sm text-muted-foreground">
              The code on screen changes every {state?.rotationSeconds ?? 30} seconds,
              so a photo of it stops working quickly.
            </p>
          ) : null}
        </>
      ) : null}

      {isAdmin ? (
        <div className={appEnabled ? "flex flex-col gap-3 border-t border-border pt-4" : "flex flex-col gap-3"}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">Welcome desk</span>
            <Button
              
              variant="outline"
              disabled={controlsUnavailable}
              onClick={() =>
                startTransition(async () => {
                  const result = await startKiosk({ occurrenceId, label: "Welcome desk" });
                  if (result.ok) {
                    setKioskCode(result.data.pairingCode);
                    refresh();
                  } else toast.error(result.message);
                })
              }
            >
              Set up a check-in station
            </Button>
          </div>

          {kiosks.length > 0 ? (
            <Button
              variant="ghost"
              className="self-start"
              disabled={pending}
              onClick={refresh}
            >
              Refresh station status
            </Button>
          ) : null}

          {state && !state.kioskEnabled ? (
            <p className="text-sm text-muted-foreground">
              Check-in stations are turned off for this service. Turn on
              &ldquo;Welcome desk kiosk&rdquo; in{" "}
              <Link href="/dashboard/attendance/setup" className="font-semibold text-accent hover:underline">
                Setup
              </Link>{" "}
              before setting one up.
            </p>
          ) : null}

          {kioskCode ? (
            <PairingCallout
              code={kioskCode}
              path="/checkin/kiosk"
              instruction="Open this address on the tablet and type the code."
              onDone={() => setKioskCode(null)}
            />
          ) : null}

          {kiosks.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border text-[15px]">
              {kiosks.map((kiosk) => (
                <li key={kiosk.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex flex-col">
                    <span className="text-foreground">{kiosk.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {kiosk.status === "pending" ? "Waiting to be set up" : "Connected"}
                    </span>
                  </span>
                  <Button
                    
                    variant="outline"
                    disabled={controlsUnavailable}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Turn off ${kiosk.label}?`,
                        description:
                          "That tablet stops checking anyone in right away. To use it again, set up a new station and type the new code on it.",
                        confirmLabel: "Turn off station",
                        destructive: true,
                      });
                      if (!ok) return;
                      startTransition(async () => {
                        const result = await endKiosk({ kioskSessionId: kiosk.id });
                        if (result.ok) {
                          toast.success(`${kiosk.label} is turned off. It can no longer check anyone in.`);
                          refresh();
                        } else toast.error(result.message);
                      });
                    }}
                  >
                    Turn off
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-sm text-muted-foreground">
            A station can find people and check them in to this service only. It
            can&rsquo;t see anything else, and it locks itself when left alone.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shows a pairing code once.
 *
 * There is no copy button on purpose. The code is meant to travel across a room
 * by being read aloud, not to land on a clipboard that another application can
 * read — and a clipboard is exactly the wrong place for a single-use credential
 * on a machine that is about to be walked away from.
 */
function PairingCallout({
  code,
  expiresAt,
  path,
  instruction,
  onDone,
}: {
  code: string;
  expiresAt?: string;
  path: string;
  instruction: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <p className="text-[15px] text-foreground">{instruction}</p>
      <p className="font-mono text-[15px] text-muted-foreground">{path}</p>
      <p className="font-mono text-3xl font-bold tracking-[0.25em] text-foreground">
        {code}
      </p>
      <p className="text-sm text-muted-foreground">
        It works once and stops working in a few minutes
        {expiresAt ? "" : ""}. Don&rsquo;t leave it on screen.
      </p>
      <div>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
