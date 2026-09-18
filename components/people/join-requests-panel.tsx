"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { decideVisitorRelationship } from "@/app/dashboard/people/claim-actions";
import type { ChurchRelationshipRow } from "@/lib/faithform/staff-relationships";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const APPROVED_MESSAGES = {
  linked: "Approved and added to People.",
  awaiting_staff:
    "Approved. Someone in People may already be them — confirm who they are on the People page.",
  not_connected: "Approved.",
} as const;

/**
 * People in the app waiting on a yes.
 *
 * These are join requests against an approval-required policy. Approving makes
 * someone a member of the church: they see what members see in the app, and
 * they become one of the church's people — added to People, or, when someone
 * by that name is already there, waiting for staff to say which person they
 * are. Declining returns them to "left"; they can still add the church again.
 */
export function JoinRequestsPanel({
  requests,
}: {
  requests: ChurchRelationshipRow[];
}) {
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  const decide = (accountId: string, action: "approve" | "reject") => {
    startTransition(async () => {
      const result = await decideVisitorRelationship({ accountId, action });
      if (result.ok) {
        toast.success(
          action === "approve"
            ? APPROVED_MESSAGES[result.data?.people ?? "not_connected"]
            : "Declined.",
        );
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Requests to join ({requests.length})
        </CardTitle>
        <CardDescription>
          These people asked to join your church in the app. Approving makes
          them members: they are added to People, and their check-ins —
          including automatic check-in — count toward attendance.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {requests.map((request) => {
          const asked = formatDate(request.requestedAt ?? request.updatedAt);
          return (
            <div
              key={request.accountId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {request.displayName ?? "Someone from the app"}
                  </span>
                  <Badge variant="outline">Pending approval</Badge>
                </div>
                {asked && (
                  <span className="text-xs text-muted-foreground">
                    Asked {asked}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => decide(request.accountId, "approve")}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => decide(request.accountId, "reject")}
                >
                  Decline
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
