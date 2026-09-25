"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addPeopleClaimAsNewPerson,
  approvePeopleClaim,
  rejectPeopleClaim,
} from "@/app/dashboard/people/claim-actions";
import type { StaffClaimRow } from "@/lib/faithform/people-claims";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

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
  "min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
export function PeopleClaimsPanel({
  claims,
  embedded = false,
}: {
  claims: StaffClaimRow[];
  embedded?: boolean;
}) {
  if (claims.length === 0) return null;

  const rows = (
    <div className="flex flex-col gap-4">
      {claims.map((claim) => (
        <ClaimRow key={claim.id} claim={claim} />
      ))}
    </div>
  );

  if (embedded) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="claims-heading">
        <div className="space-y-1">
          <h3 id="claims-heading" className="font-heading text-lg font-semibold text-foreground">
            Confirm who they are ({claims.length})
          </h3>
          <p className="text-[15px] text-muted-foreground">
            They&apos;re in your church&apos;s app, and someone in People may
            already be them. Pick the right person, or add them as someone new.
            Nothing is linked until you choose.
          </p>
        </div>
        {rows}
      </section>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          Confirm who they are ({claims.length})
        </CardTitle>
        <CardDescription className="text-[15px]">
          These people are in your church&apos;s app, and someone in People
          may already be them. Choose the right person, or add them as someone
          new. Nothing is linked until you choose.
        </CardDescription>
      </CardHeader>
      <CardContent>{rows}</CardContent>
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
  const chosen = claim.candidates.find((c) => c.memberId === selected) ?? null;
  const chosenName = chosen
    ? [chosen.firstName, chosen.lastName].filter(Boolean).join(" ")
    : "";

  const link = () => {
    if (!selected) {
      toast.error("Choose which person this is first.");
      return;
    }
    startTransition(async () => {
      const result = await approvePeopleClaim({ claimId: claim.id, memberId: selected });
      if (result.ok) {
        toast.success(
          chosenName ? `${name} is now linked to ${chosenName}.` : `${name} is now linked.`,
        );
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
      if (result.ok) {
        toast.success(`${[firstName.trim(), lastName.trim()].filter(Boolean).join(" ")} added to People.`);
      } else {
        toast.error(result.message);
      }
    });
  };

  const decline = (dispute: boolean) => {
    startTransition(async () => {
      const result = await rejectPeopleClaim({ claimId: claim.id, dispute });
      if (result.ok) {
        toast.success(dispute ? `${name} flagged for review.` : `${name}'s request declined.`);
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
          {name}
          {claim.status === "disputed" && (
            <StatusBadge tone="attention">Needs a decision</StatusBadge>
          )}
        </span>
        <span className="text-sm text-muted-foreground">{SOURCE_LABELS[claim.source]}</span>
      </div>

      <p className="text-sm text-muted-foreground">
        {claim.source === "join"
          ? claim.claimedName
            ? "This is the name on their app account."
            : "Their app account has no name, so we couldn't match it."
          : `They gave ${contact || "no contact details"}.`}
      </p>

      {claim.candidates.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">
          Nobody in People matches. Add them as someone new.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="mb-1 text-[15px] font-semibold text-foreground">
            Is {name} one of these people?
          </legend>
          {claim.candidates.map((candidate) => (
            <label
              key={candidate.memberId}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors",
                selected === candidate.memberId
                  ? "border-accent bg-accent/10"
                  : "border-border hover:border-accent/50",
                candidate.alreadyLinked && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={`claim-${claim.id}`}
                className="size-5 accent-current"
                disabled={candidate.alreadyLinked}
                checked={selected === candidate.memberId}
                onChange={() => setSelected(candidate.memberId)}
              />
              <span className="flex flex-col">
                <span className="text-base font-medium text-foreground">
                  {candidate.firstName} {candidate.lastName}
                </span>
                <span className="text-sm text-muted-foreground">
                  {candidate.alreadyLinked
                    ? "Already connected to another app account"
                    : `Suggested because of the ${candidate.matchedOn
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
          className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            addNew();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-[15px] font-semibold text-foreground">
              First name
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[15px] font-semibold text-foreground">
              Last name (optional)
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Add to People
            </Button>
            <Button
              type="button"
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
            <Button disabled={pending || !selected} onClick={link}>
              {chosenName ? `Yes, this is ${chosenName}` : "Choose a person above"}
            </Button>
          ) : null}
          <Button
            variant={claim.candidates.length > 0 ? "outline" : "default"}
            disabled={pending}
            onClick={() => setAddingNew(true)}
          >
            Add as someone new
          </Button>
          {/* A join is already a membership, so there is nothing to decline:
              the only question is which person they are. */}
          {claim.source !== "join" ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => decline(false)}>
                Decline
              </Button>
              {claim.status !== "disputed" && (
                <Button variant="ghost" disabled={pending} onClick={() => decline(true)}>
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
