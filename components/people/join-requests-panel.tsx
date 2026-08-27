"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { decideVisitorRelationship } from "@/app/dashboard/people/claim-actions";
import type { ChurchRelationshipRow } from "@/lib/faithful/staff-relationships";
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

/**
 * People in the app waiting on a yes.
 *
 * These are join requests against an approval-required policy. Approving makes
 * someone a member *in the app* — feed access at member visibility, nothing
 * more. Declining returns them to "left"; they can still follow what the
 * church publishes publicly.
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
        toast.success(action === "approve" ? "Approved." : "Declined.");
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
          Someone using the app asked to join your church. Approving admits
          them as a member in the app; it never grants dashboard access.
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
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">
                  {request.displayName ?? "Someone from the app"}
                </span>
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
