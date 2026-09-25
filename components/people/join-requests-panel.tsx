"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { decideVisitorRelationship } from "@/app/dashboard/people/claim-actions";
import type { ChurchRelationshipRow } from "@/lib/faithform/staff-relationships";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatFriendlyDate } from "@/components/people/people-format";

function approvedMessage(
  name: string,
  outcome: "linked" | "awaiting_staff" | "not_connected",
): string {
  if (outcome === "linked") return `${name} approved and added to People.`;
  if (outcome === "awaiting_staff") {
    return `${name} approved. Someone in People may already be them. Confirm who they are under "Confirm who they are".`;
  }
  return `${name} approved.`;
}

/**
 * People in the app waiting on a yes.
 *
 * These are join requests against an approval-required policy. Approving makes
 * someone a member of the church: they see what members see in the app, and
 * they become one of the church's people — added to People, or, when someone
 * by that name is already there, waiting for staff to say which person they
 * are. Declining returns them to "left"; they can still add the church again.
 *
 * `embedded` drops the card chrome so People can show this inside its one
 * "Needs your attention" card; the App page still shows it as its own card.
 */
export function JoinRequestsPanel({
  requests,
  embedded = false,
}: {
  requests: ChurchRelationshipRow[];
  embedded?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  const decide = (
    accountId: string,
    name: string,
    action: "approve" | "reject",
  ) => {
    startTransition(async () => {
      const result = await decideVisitorRelationship({ accountId, action });
      if (result.ok) {
        toast.success(
          action === "approve"
            ? approvedMessage(name, result.data?.people ?? "not_connected")
            : `${name}'s request declined.`,
        );
      } else {
        toast.error(result.message);
      }
    });
  };

  const rows = (
    <ul className="flex flex-col gap-3">
      {requests.map((request) => {
        const asked = formatFriendlyDate(request.requestedAt ?? request.updatedAt);
        const name = request.displayName ?? "Someone from the app";
        return (
          <li
            key={request.accountId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base font-semibold text-foreground">
                {name}
              </span>
              <span className="text-sm text-muted-foreground">
                {asked ? `Asked to join on ${asked}` : "Asked to join"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={pending}
                onClick={() => decide(request.accountId, name, "approve")}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => decide(request.accountId, name, "reject")}
              >
                Decline
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (embedded) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="join-requests-heading">
        <div className="space-y-1">
          <h3 id="join-requests-heading" className="font-heading text-lg font-semibold text-foreground">
            Asked to join ({requests.length})
          </h3>
          <p className="text-[15px] text-muted-foreground">
            Approve to make them members. They&apos;re added to People and
            their check-ins count.
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
          Requests to join ({requests.length})
        </CardTitle>
        <CardDescription className="text-[15px]">
          These people asked to join your church in the app. Approving makes
          them members: they are added to People, and their check-ins —
          including automatic check-in — count toward attendance.
        </CardDescription>
      </CardHeader>
      <CardContent>{rows}</CardContent>
    </Card>
  );
}
