"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, KeyRound, QrCode, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  completeCheckout,
  lookupCheckoutCredential,
  lookupHouseholdForOverride,
  type CheckoutLookup,
} from "@/app/dashboard/checkin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CHECKOUT_METHOD_LABELS } from "@/types/checkin";

/**
 * The desk where a child is released.
 *
 * Two credentials get you to the same place — a list of this household's
 * children and the adults entitled to collect them — and neither releases
 * anybody. A staff member ticks who is actually leaving and confirms. That
 * second step is the point: the credential proves the family, the person at the
 * desk confirms the handover, and both halves are recorded.
 *
 * A scanner is a keyboard. Most QR readers churches buy type the payload and
 * press Enter, so the scan field is a plain text input that submits on Enter —
 * no camera permission, no device pairing, nothing to go wrong at 9am.
 */
export function CheckoutConsole() {
  const [pending, startTransition] = useTransition();
  const [lookup, setLookup] = useState<CheckoutLookup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releasedTo, setReleasedTo] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [codeValue, setCodeValue] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideMatches, setOverrideMatches] = useState<CheckoutLookup[] | null>(
    null,
  );

  function runOverrideSearch() {
    startTransition(async () => {
      const result = await lookupHouseholdForOverride(overrideSearch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOverrideMatches(result.data);
      if (result.data.length === 0) {
        toast.error("No checked-in children match that name.");
      }
    });
  }

  // Anything reached by name is an override by construction — there was no
  // credential — so the reason box is open before the desk can confirm.
  function chooseOverrideHousehold(match: CheckoutLookup) {
    setLookup(match);
    setSelected(new Set(match.sessions.map((s) => s.id)));
    setReleasedTo(match.guardians[0]?.memberId ?? "");
    setOverrideMode(true);
    setOverrideReason("");
    setOverrideMatches(null);
    setOverrideSearch("");
  }

  function runLookup(kind: "qr" | "code", value: string) {
    if (!value.trim()) return;

    startTransition(async () => {
      const result = await lookupCheckoutCredential({ kind, value: value.trim() });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setLookup(result.data);
      setSelected(new Set(result.data.sessions.map((s) => s.id)));
      setReleasedTo(result.data.guardians[0]?.memberId ?? "");
      setOverrideMode(false);
      setOverrideReason("");
      setScanValue("");
      setCodeValue("");
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

  function handleRelease() {
    if (!lookup) return;
    if (selected.size === 0) {
      toast.error("Tick who is being collected.");
      return;
    }

    startTransition(async () => {
      const result = await completeCheckout({
        sessionIds: Array.from(selected),
        method: overrideMode ? "override" : lookup.method,
        releasedToMemberId: releasedTo || undefined,
        overrideReason: overrideMode ? overrideReason : undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `Released ${result.data.released} ${result.data.released === 1 ? "child" : "children"}.`,
      );
      setLookup(null);
      setSelected(new Set());
    });
  }

  const pickupOptions = lookup
    ? [...lookup.guardians, ...lookup.authorizedPickups]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="size-4" aria-hidden />
              Scan a QR code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="checkout-scan" className="sr-only">
              Scanned QR payload
            </Label>
            <Input
              id="checkout-scan"
              autoFocus
              value={scanValue}
              placeholder="Click here, then scan"
              disabled={pending}
              onChange={(event) => setScanValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runLookup("qr", scanValue);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              A handheld scanner types the code and presses Enter for you.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden />
              Enter this week&rsquo;s code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="checkout-code" className="sr-only">
              Six-digit code
            </Label>
            <div className="flex gap-2">
              <Input
                id="checkout-code"
                inputMode="numeric"
                maxLength={7}
                value={codeValue}
                placeholder="000000"
                disabled={pending}
                className="font-mono tracking-[0.3em]"
                onChange={(event) => setCodeValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runLookup("code", codeValue);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending || codeValue.replace(/\D/g, "").length !== 6}
                onClick={() => runLookup("code", codeValue)}
              >
                Find
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Codes change every week. Last week&rsquo;s will not open anything.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4" aria-hidden />
            No phone, no code
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Find the family by name, check ID yourself, and record what you
            checked. Every release this way is flagged for review.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Label htmlFor="override-search" className="sr-only">
              Family or child&rsquo;s name
            </Label>
            <Input
              id="override-search"
              value={overrideSearch}
              placeholder="Family or child's name"
              disabled={pending}
              onChange={(event) => setOverrideSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runOverrideSearch();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending || overrideSearch.trim().length < 2}
              onClick={runOverrideSearch}
            >
              Search
            </Button>
          </div>

          {overrideMatches && overrideMatches.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {overrideMatches.map((match) => (
                <li key={match.householdId}>
                  <button
                    type="button"
                    onClick={() => chooseOverrideHousehold(match)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="font-medium">{match.householdName}</span>
                    <span className="text-xs text-muted-foreground">
                      {match.sessions.length} checked in
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {lookup && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{lookup.householdName}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {lookup.method === "override"
                  ? "Found by name — no credential was presented."
                  : `Verified by ${CHECKOUT_METHOD_LABELS[lookup.method].toLowerCase()}.`}
              </p>
            </div>
            <Badge variant={lookup.method === "override" ? "warning" : "success"}>
              {lookup.method === "override" ? "Needs an override" : "Credential valid"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {lookup.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody from this household is checked in right now.
              </p>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">
                    Who is being collected
                  </legend>
                  {lookup.sessions.map((session) => (
                    <label
                      key={session.id}
                      className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={selected.has(session.id)}
                        onChange={() => toggle(session.id)}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {session.firstName} {session.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {session.locationName}
                          {session.status === "pre_checked_in" &&
                            " · pre-checked in, never received"}
                        </p>
                        {session.medicalNotes?.trim() && (
                          <p className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                            <AlertTriangle
                              className="mt-px size-3.5 shrink-0"
                              aria-hidden
                            />
                            <span>{session.medicalNotes}</span>
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </fieldset>

                <div className="space-y-2">
                  <Label htmlFor="released-to">Released to</Label>
                  <Select
                    id="released-to"
                    value={releasedTo}
                    onChange={(event) => setReleasedTo(event.target.value)}
                  >
                    <option value="">Not recorded</option>
                    {pickupOptions.map((option) => (
                      <option key={option.memberId} value={option.memberId}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Guardians and anyone this household has pre-authorized.
                  </p>
                </div>

                {overrideMode && (
                  <div className="space-y-2 rounded-[10px] border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <Label htmlFor="override-reason" className="flex items-center gap-1.5">
                      <ShieldAlert className="size-4" aria-hidden />
                      Why this is being overridden
                    </Label>
                    <Input
                      id="override-reason"
                      value={overrideReason}
                      placeholder="Checked driver's licence — Sarah Doe, mother"
                      onChange={(event) => setOverrideReason(event.target.value)}
                    />
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Overrides are recorded against your name and flagged for
                      review.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={pending || selected.size === 0}
                    onClick={handleRelease}
                  >
                    Confirm release
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setLookup(null);
                      setSelected(new Set());
                    }}
                  >
                    Cancel
                  </Button>
                  {lookup.method !== "override" && (
                    <button
                      type="button"
                      onClick={() => setOverrideMode((value) => !value)}
                      className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      {overrideMode ? "Use the credential instead" : "Override…"}
                    </button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
