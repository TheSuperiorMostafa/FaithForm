"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approvePeopleClaim,
  rejectPeopleClaim,
} from "@/app/dashboard/people/claim-actions";
import type { StaffClaimRow } from "@/lib/faithful/people-claims";
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

/**
 * Pending "this is me" requests from the app.
 *
 * The panel never picks for you. Candidates are suggestions with the reason
 * they surfaced spelled out, because a shared family phone number or a
 * repeated name is exactly the case where guessing would link the wrong person.
 */
export function PeopleClaimsPanel({ claims }: { claims: StaffClaimRow[] }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, string>>({});

  if (claims.length === 0) return null;

  const approve = (claimId: string) => {
    const memberId = selected[claimId];
    if (!memberId) {
      toast.error("Choose which person this is first.");
      return;
    }
    startTransition(async () => {
      const result = await approvePeopleClaim({ claimId, memberId });
      if (result.ok) toast.success("Linked.");
      else toast.error(result.message);
    });
  };

  const decline = (claimId: string, dispute: boolean) => {
    startTransition(async () => {
      const result = await rejectPeopleClaim({ claimId, dispute });
      if (result.ok) toast.success(dispute ? "Flagged for review." : "Declined.");
      else toast.error(result.message);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Requests to be matched ({claims.length})
        </CardTitle>
        <CardDescription>
          Someone using the app says one of these people is them. Nothing is
          linked until you choose.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {claims.map((claim) => (
          <div
            key={claim.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">
                {claim.claimedName ?? "Someone"}
                {claim.status === "disputed" && (
                  <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
                    Needs a decision
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {claim.source === "invitation" ? "From your invitation" : "Asked in the app"}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              They gave{" "}
              {[claim.claimedEmail, claim.claimedPhone].filter(Boolean).join(" and ") ||
                "no contact details"}
              .
            </p>

            {claim.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody in your directory matches. Decline, or add them on the
                People list first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {claim.candidates.map((candidate) => (
                  <label
                    key={candidate.memberId}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm transition-colors ${
                      selected[claim.id] === candidate.memberId
                        ? "border-accent bg-accent/10"
                        : "border-border hover:border-accent/50"
                    } ${candidate.alreadyLinked ? "opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`claim-${claim.id}`}
                      className="accent-current"
                      disabled={candidate.alreadyLinked || pending}
                      checked={selected[claim.id] === candidate.memberId}
                      onChange={() =>
                        setSelected({ ...selected, [claim.id]: candidate.memberId })
                      }
                    />
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {candidate.firstName} {candidate.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {candidate.alreadyLinked
                          ? "Already linked to another account"
                          : `Suggested — ${candidate.matchedOn
                              .map((reason) => MATCH_LABELS[reason] ?? reason)
                              .join(", ")}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || !selected[claim.id]}
                onClick={() => approve(claim.id)}
              >
                Link this person
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => decline(claim.id, false)}
              >
                Decline
              </Button>
              {claim.status !== "disputed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => decline(claim.id, true)}
                >
                  Flag for review
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
