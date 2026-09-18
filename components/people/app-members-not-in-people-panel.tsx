"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { addAppMemberToPeople } from "@/app/dashboard/people/claim-actions";
import type { AppMemberNotInPeople } from "@/lib/faithform/app-people";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const OUTCOME_MESSAGES = {
  linked: { ok: true, message: "Added to People." },
  already_linked: { ok: true, message: "They were already in People." },
  awaiting_staff: {
    ok: true,
    message: "One more step: confirm who they are in the list above.",
  },
  not_joined: { ok: false, message: "They are no longer a member in the app." },
  account_inactive: { ok: false, message: "Their app account is being closed." },
} as const;

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Members of the church in the app who are not in People yet.
 *
 * Joining normally adds someone to People on the spot, so this is usually
 * empty. It lists whoever that could not place — joined before the change, or
 * the add failed — so nobody who belongs to the church is invisible to it,
 * and nobody's automatic check-in stays stuck without anyone knowing why.
 */
export function AppMembersNotInPeoplePanel({
  people,
}: {
  people: AppMemberNotInPeople[];
}) {
  const [pending, startTransition] = useTransition();

  if (people.length === 0) return null;

  const add = (accountId: string) => {
    startTransition(async () => {
      const result = await addAppMemberToPeople({ accountId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const outcome = OUTCOME_MESSAGES[result.data.outcome];
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          In your app, not in People yet ({people.length})
        </CardTitle>
        <CardDescription>
          These members joined your church in the app. Add them so they show
          up here, on the weekly sheet, and so their check-ins count.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {people.map((person) => {
          const joined = formatDate(person.joinedAt);
          return (
            <div
              key={person.accountId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-semibold text-foreground">
                  {person.displayName ?? "Someone from the app"}
                </span>
                {joined ? (
                  <span className="text-xs text-muted-foreground">Joined {joined}</span>
                ) : null}
              </div>
              <Button size="sm" disabled={pending} onClick={() => add(person.accountId)}>
                Add to People
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
