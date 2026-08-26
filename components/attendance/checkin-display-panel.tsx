"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
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
}: {
  occurrenceId: string;
  isAdmin: boolean;
}) {
  const [state, setState] = useState<CheckinDisplayState | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [kiosks, setKiosks] = useState<KioskSummary[]>([]);
  const [kioskCode, setKioskCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      const [display, desks] = await Promise.all([
        getCheckinDisplayState(occurrenceId),
        listKiosks(occurrenceId),
      ]);
      if (display.ok) setState(display.data);
      if (desks.ok) setKiosks(desks.data);
    });
  }, [occurrenceId]);

  useEffect(() => {
    // A new service is selected: forget the previous one's codes rather than
    // leaving a live pairing code on screen under the wrong heading.
    setPairing(null);
    setKioskCode(null);
    refresh();
  }, [occurrenceId, refresh]);

  if (state && !state.signingConfigured) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Check-in codes aren&rsquo;t set up on this FaithForm installation yet.
        Ask whoever runs it to finish the check-in setup &mdash; the steps are in
        the deployment runbook.
      </div>
    );
  }

  const running = Boolean(state?.sessionId);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">Check-in display</span>
        {running ? (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
            Running
          </span>
        ) : null}

        {running ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
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
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await stopCheckinDisplay({ sessionId: state!.sessionId! });
                  if (result.ok) {
                    setPairing(null);
                    toast.success("Check-in display stopped. Nobody already counted was affected.");
                    refresh();
                  } else toast.error(result.message);
                })
              }
            >
              Stop display
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={pending}
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
            Start check-in display
          </Button>
        )}
      </div>

      {pairing ? (
        <PairingCallout
          code={pairing.code}
          expiresAt={pairing.expiresAt}
          path="/checkin/display"
          instruction="Open this address on the projector and type the code."
          onDone={() => setPairing(null)}
        />
      ) : null}

      {running ? (
        <p className="text-xs text-muted-foreground">
          The code on screen changes every {state?.rotationSeconds ?? 30} seconds.
          Rotation makes a shared screenshot go stale quickly — it does not prove
          anyone was in the room.
        </p>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">Welcome desk</span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
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

          {kioskCode ? (
            <PairingCallout
              code={kioskCode}
              path="/checkin/kiosk"
              instruction="Open this address on the tablet and type the code."
              onDone={() => setKioskCode(null)}
            />
          ) : null}

          {kiosks.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {kiosks.map((kiosk) => (
                <li key={kiosk.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex flex-col">
                    <span className="text-foreground">{kiosk.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {kiosk.status === "pending" ? "Waiting to be set up" : "Connected"}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await endKiosk({ kioskSessionId: kiosk.id });
                        if (result.ok) {
                          toast.success("That station can no longer check anyone in.");
                          refresh();
                        } else toast.error(result.message);
                      })
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted-foreground">
            A station can search this church&rsquo;s People and check them into
            this service. It cannot export People, change attendance, see another
            service, or reach the dashboard, and it locks itself when left idle.
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
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <p className="text-sm text-foreground">{instruction}</p>
      <p className="font-mono text-sm text-muted-foreground">{path}</p>
      <p className="font-mono text-3xl font-bold tracking-[0.25em] text-foreground">
        {code}
      </p>
      <p className="text-xs text-muted-foreground">
        Single use, and it stops working in a few minutes
        {expiresAt ? "" : ""}. Don&rsquo;t leave it on screen.
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
