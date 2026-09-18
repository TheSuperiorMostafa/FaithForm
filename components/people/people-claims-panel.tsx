"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addPeopleClaimAsNewPerson,
  approvePeopleClaim,
  rejectPeopleClaim,
} from "@/app/dashboard/people/claim-actions";
import type { StaffClaimRow } from "@/lib/faithform/people-claims";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MATCH_LABELS: Record<string, string> = {
  email: "same email",
  phone: "same phone",
  name: "same name",
};

const SOURCE_LABELS: Record<StaffClaimRow["source"], string> = {
  join: "Joined in the app",
  self_request: "Asked in the app",
  invitation: "From your invitation",
};

const inputClassName =
  "min-h-10 w-full rounded-lg border-[1.5px] border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * People in the app waiting on staff to say who they are.
 *
 * Most people who join never appear here: someone new is added to People on
 * joining. This is for the rest — someone by the same name is already in
 * People, or the app account has no name — which is exactly where guessing
 * would link the wrong person. So the panel never picks: candidates are
 * suggestions with the reason they surfaced spelled out, and the two answers
 * are "this is them" or "this is someone new".
 */
export function PeopleClaimsPanel({ claims }: { claims: StaffClaimRow[] }) {
  if (claims.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Confirm who they are ({claims.length})
        </CardTitle>
        <CardDescription>
          These people are in your church&apos;s app, and someone in People
          may already be them. Choose the right person, or add them as someone
          new — their check-ins, including automatic check-in, count from then
          on. Nothing is linked until you choose.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {claims.map((claim) => (
          <ClaimRow key={claim.id} claim={claim} />
        ))}
      </CardContent>
    </Card>
  );
}

function ClaimRow({ claim }: { claim: StaffClaimRow }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [firstName, setFirstName] = useState(claim.claimedFirstName ?? "");
  const [lastName, setLastName] = useState(claim.claimedLastName ?? "");

  const name = claim.claimedName ?? "Someone from the app";
  const contact = [claim.claimedEmail, claim.claimedPhone].filter(Boolean).join(" and ");

  const link = () => {
    if (!selected) {
      toast.error("Choose which person this is first.");
      return;
    }
    const candidate = claim.candidates.find((c) => c.memberId === selected);
    startTransition(async () => {
      const result = await approvePeopleClaim({ claimId: claim.id, memberId: selected });
      if (result.ok) {
        const who = candidate
          ? [candidate.firstName, candidate.lastName].filter(Boolean).join(" ")
          : "";
        toast.success(who ? `Linked to ${who}.` : "Linked.");
      } else {
        toast.error(result.message);
      }
    });
  };

  const addNew = () => {
    if (!firstName.trim()) {
      toast.error("Enter at least a first name.");
      return;
    }
    startTransition(async () => {
      const result = await addPeopleClaimAsNewPerson({
        claimId: claim.id,
        firstName,
        lastName,
      });
      if (result.ok) toast.success("Added to People.");
      else toast.error(result.message);
    });
  };

  const decline = (dispute: boolean) => {
    startTransition(async () => {
      const result = await rejectPeopleClaim({ claimId: claim.id, dispute });
      if (result.ok) toast.success(dispute ? "Flagged for review." : "Declined.");
      else toast.error(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          {name}
          {claim.status === "disputed" && (
            <Badge variant="destructive" className="px-2 py-0.5 text-[11px]">
              Needs a decision
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{SOURCE_LABELS[claim.source]}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        {claim.source === "join"
          ? claim.claimedName
            ? "The name on their app account."
            : "Their app account has no name, so it could not be matched."
          : `They gave ${contact || "no contact details"}.`}
      </p>

      {claim.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody in People matches. Add them as someone new.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="sr-only">Who is {name}?</legend>
          {claim.candidates.map((candidate) => (
            <label
              key={candidate.memberId}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm transition-colors ${
                selected === candidate.memberId
                  ? "border-accent bg-accent/10"
                  : "border-border hover:border-accent/50"
              } ${candidate.alreadyLinked ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={`claim-${claim.id}`}
                className="accent-current"
                disabled={candidate.alreadyLinked}
                checked={selected === candidate.memberId}
                onChange={() => setSelected(candidate.memberId)}
              />
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  {candidate.firstName} {candidate.lastName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {candidate.alreadyLinked
                    ? "Already connected to another app account"
                    : `Suggested — ${candidate.matchedOn
                        .map((reason) => MATCH_LABELS[reason] ?? reason)
                        .join(", ")}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {addingNew ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            addNew();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              First name
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              Last name (optional)
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Add to People
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setAddingNew(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {claim.candidates.length > 0 ? (
            <Button size="sm" disabled={pending || !selected} onClick={link}>
              Link this person
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={claim.candidates.length > 0 ? "outline" : "default"}
            disabled={pending}
            onClick={() => setAddingNew(true)}
          >
            Add as new person
          </Button>
          {/* A join is already a membership, so there is nothing to decline:
              the only question is which person they are. */}
          {claim.source !== "join" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => decline(false)}
              >
                Decline
              </Button>
              {claim.status !== "disputed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => decline(true)}
                >
                  Flag for review
                </Button>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
