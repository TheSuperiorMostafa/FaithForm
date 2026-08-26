"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PairingForm } from "@/components/checkin/pairing-form";

type Person = {
  memberId: string;
  firstName: string;
  lastName: string;
  alreadyCounted: boolean;
};

type Outcome = { memberId: string; message: string; ok: boolean };

/**
 * The welcome-desk kiosk.
 *
 * ## What this device can do, exhaustively
 *
 * Search this church's People by name, and check one of them into **one**
 * service. That is the whole list. It cannot reverse a check-in, see another
 * service, export anything, read a phone number or an email address, or reach
 * any part of the dashboard — not because those buttons are hidden but because
 * the credential it holds resolves to an occurrence and a church and carries no
 * user, no role, and no session.
 *
 * ## Why the search behaves like this
 *
 * Nothing is returned below three characters, matching is by prefix rather than
 * substring, at most eight people come back, and there is no next page. A
 * congregation's directory should not be browsable by whoever is standing at
 * the desk, and every one of those four rules exists to stop a query being
 * widened into a listing.
 *
 * ## Why it never claims a check-in it did not get
 *
 * There is no local queue. If the request does not reach the server, the screen
 * says the desk is offline — it does not show a tick and hope. Telling someone
 * they were counted before anything decided that they were is worse than
 * telling them to try again, because only one of those two is recoverable.
 */
export function KioskStation() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locked, setLocked] = useState(false);
  const [offline, setOffline] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [minLength, setMinLength] = useState(3);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  const runSearch = useCallback(async (value: string) => {
    const term = value.trim();
    if (term.length < minLength) {
      setPeople([]);
      setTruncated(false);
      return;
    }

    const ticket = ++inFlight.current;
    setSearching(true);

    try {
      const response = await fetch("/api/checkin/kiosk/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // POST, not a query string: a congregation member's name does not
        // belong in a browser history or a proxy log.
        body: JSON.stringify({ query: term }),
      });

      // A slow earlier search must not overwrite a faster later one.
      if (ticket !== inFlight.current) return;

      if (response.status === 423) {
        setLocked(true);
        setPeople([]);
        return;
      }
      if (response.status === 401) {
        setPaired(false);
        return;
      }
      if (!response.ok) {
        setOffline(true);
        return;
      }

      const body = await response.json();
      setLocked(false);
      setOffline(false);
      setPeople(body.people ?? []);
      setTruncated(Boolean(body.truncated));
      if (typeof body.minLength === "number") setMinLength(body.minLength);
    } catch {
      if (ticket === inFlight.current) setOffline(true);
    } finally {
      if (ticket === inFlight.current) setSearching(false);
    }
  }, [minLength]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(query), 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, runSearch]);

  // Find out whether this device is already paired without asking for anything.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/checkin/kiosk/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "" }),
        });
        if (cancelled) return;
        if (response.status === 401) setPaired(false);
        else {
          setPaired(true);
          setLocked(response.status === 423);
        }
      } catch {
        if (!cancelled) setPaired(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function checkIn(person: Person) {
    setOutcome(null);
    try {
      const response = await fetch("/api/checkin/kiosk/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: person.memberId,
          // A fresh key per tap, so two people with the same name checked in
          // back to back are two attempts — while a retry of *this* tap after a
          // dropped response finds the first one.
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      if (response.status === 423) {
        setLocked(true);
        return;
      }
      if (response.status === 401) {
        setPaired(false);
        return;
      }
      if (!response.ok) {
        setOffline(true);
        setOutcome({
          memberId: person.memberId,
          ok: false,
          message: "The desk is offline. Nothing was recorded — try again.",
        });
        return;
      }

      const body = await response.json();
      setOffline(false);
      // **Only the server's word.** `ok` here is the server's own verdict on
      // whether a fact exists, never an optimistic local decision.
      setOutcome({ memberId: person.memberId, ok: Boolean(body.ok), message: body.message });

      if (body.ok) {
        setPeople((current) =>
          current.map((entry) =>
            entry.memberId === person.memberId ? { ...entry, alreadyCounted: true } : entry,
          ),
        );
        // Clear the search after a success. Leaving a congregation member's
        // name on an unattended screen is the same directory exposure the
        // search rules exist to prevent.
        setTimeout(() => {
          setQuery("");
          setPeople([]);
          setOutcome(null);
        }, 2500);
      }
    } catch {
      setOffline(true);
      setOutcome({
        memberId: person.memberId,
        ok: false,
        message: "The desk is offline. Nothing was recorded — try again.",
      });
    }
  }

  async function lock() {
    await fetch("/api/checkin/kiosk/lock", { method: "POST" }).catch(() => {});
    setPaired(false);
    setQuery("");
    setPeople([]);
  }

  if (paired === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <p className="text-xl">Starting…</p>
      </div>
    );
  }

  if (!paired) {
    return (
      <PairingForm
        title="Set up this check-in station"
        hint="An administrator starts a kiosk from the dashboard and reads you the code."
        endpoint="/api/checkin/kiosk/pair"
        onPaired={() => setPaired(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold">Check in</h1>
          <button
            type="button"
            onClick={() => void lock()}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
          >
            Lock
          </button>
        </div>

        {locked ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
            <p className="text-lg text-amber-200">
              This station locked itself after sitting idle.
            </p>
            <p className="mt-2 text-sm text-amber-200/70">
              Search again to unlock it, or ask an administrator for a new code.
            </p>
          </div>
        ) : null}

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search by name"
          placeholder="Type at least three letters of a name"
          className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5 text-2xl outline-none focus:border-slate-400"
        />

        {offline ? (
          <p role="status" className="text-base text-amber-300">
            The desk is offline. Nothing is being recorded.
          </p>
        ) : null}

        <div aria-live="polite" className="space-y-3">
          {query.trim().length > 0 && query.trim().length < minLength ? (
            <p className="text-slate-400">
              Keep typing — at least {minLength} letters.
            </p>
          ) : null}

          {searching ? <p className="text-slate-500">Searching…</p> : null}

          {people.map((person) => {
            const result = outcome?.memberId === person.memberId ? outcome : null;
            return (
              <button
                key={person.memberId}
                type="button"
                onClick={() => void checkIn(person)}
                disabled={person.alreadyCounted}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5 text-left disabled:opacity-60"
              >
                <span className="text-xl">
                  {person.firstName} {person.lastName}
                </span>
                <span className={result && !result.ok ? "text-amber-300" : "text-slate-400"}>
                  {result ? result.message : person.alreadyCounted ? "Checked in" : "Check in"}
                </span>
              </button>
            );
          })}

          {truncated ? (
            <p className="text-slate-400">
              More people match that. Type a little more to narrow it down.
            </p>
          ) : null}

          {!searching && people.length === 0 && query.trim().length >= minLength ? (
            <p className="text-slate-400">
              Nobody matches that. Ask a volunteer if the spelling is different.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
