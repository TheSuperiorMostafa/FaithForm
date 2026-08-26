"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PairingForm } from "@/components/checkin/pairing-form";

type Frame = {
  qrImage: string;
  shortCode: string | null;
  rotatesAt: string;
  expiresAt: string;
  rotationSeconds: number;
  sessionExpiresAt: string;
};

/**
 * The projector.
 *
 * ## What is on this machine
 *
 * A cookie holding a capability that can read one occurrence's current code.
 * That is the entire authority present in the room: no account, no role, no
 * church settings, no People, and nothing that can write. If the machine is
 * stolen, what the thief has is the ability to watch a code they could already
 * see on the wall.
 *
 * ## Recovering from a refresh
 *
 * Three separate things had to be true for a reload to be invisible, and all
 * three are, deliberately:
 *
 *   * the capability is in a cookie, so it survives the reload;
 *   * the code is derived from the rotation window rather than drawn when
 *     asked, so a reload lands on the code already on the wall instead of
 *     rotating it early and stranding everyone mid-scan; and
 *   * the frame carries `rotatesAt`, so a machine that slept knows the code it
 *     is holding is stale and fetches immediately rather than on a timer.
 *
 * ## Why it never counts anything
 *
 * The display shows a code. It has no idea who is in the room, receives no
 * People data, and is never told whether anyone was counted. Attendance is
 * decided when a phone submits, by the server, against that person's own
 * verified People link.
 */
export function CheckinDisplayBoard() {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [status, setStatus] = useState<"loading" | "unpaired" | "live" | "offline">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/checkin/display/frame", { cache: "no-store" });

      if (response.status === 401) {
        setFrame(null);
        setStatus("unpaired");
        return;
      }
      if (!response.ok) {
        // Keep showing the code already on the wall. A blank projector mid
        // service is worse than a code that has a few seconds left on it, and
        // the server refuses a stale one anyway.
        setStatus("offline");
        scheduleIn(3000);
        return;
      }

      const body = (await response.json()) as Frame & { ok: boolean };
      if (!body.ok) {
        setStatus("unpaired");
        return;
      }

      setFrame(body);
      setStatus("live");

      // Wake just after the rotation boundary rather than on a fixed interval,
      // so a machine that drifts or sleeps re-syncs instead of accumulating lag.
      const untilRotation = new Date(body.rotatesAt).getTime() - Date.now();
      scheduleIn(Math.max(1000, untilRotation + 250));
    } catch {
      setStatus("offline");
      scheduleIn(3000);
    }
  }, []);

  const scheduleIn = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), delay);
    },
    [load],
  );

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // A projector that was asleep must not keep showing an expired code.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (status === "unpaired") {
    return (
      <PairingForm
        title="Connect this display"
        hint="Start check-in from the dashboard, then type the code it shows you."
        endpoint="/api/checkin/display/pair"
        onPaired={() => {
          setStatus("loading");
          void load();
        }}
      />
    );
  }

  if (!frame) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <p className="text-xl">Connecting…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-white p-8">
      <h1 className="font-heading text-4xl font-semibold text-slate-900 sm:text-5xl">
        Check in
      </h1>

      {/* eslint-disable-next-line @next/next/no-img-element -- a data URI that
          changes every rotation; the image optimiser would be a cache in front
          of a live capability. */}
      <img
        src={frame.qrImage}
        alt="Scan this code with the Faithful app to check in"
        className="h-auto w-[min(70vh,70vw)] max-w-[720px]"
      />

      {frame.shortCode ? (
        <div className="text-center">
          <p className="text-lg text-slate-500">Can&rsquo;t scan? Enter this code:</p>
          <p className="font-mono text-5xl font-bold tracking-[0.2em] text-slate-900 sm:text-6xl">
            {frame.shortCode}
          </p>
        </div>
      ) : null}

      <p className="text-base text-slate-400">
        This code changes every {frame.rotationSeconds} seconds.
      </p>

      {status === "offline" ? (
        <p role="status" className="text-base text-amber-600">
          Reconnecting — this code may be about to change.
        </p>
      ) : null}
    </div>
  );
}
