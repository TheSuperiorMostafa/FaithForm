"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { addAppMemberToPeople } from "@/app/dashboard/people/claim-actions";
import type { AppMemberNotInPeople, ConnectOutcome } from "@/lib/faithform/app-people";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatFriendlyDate } from "@/components/people/people-format";

function outcomeMessage(
  name: string,
  outcome: ConnectOutcome,
): { ok: boolean; message: string } {
  switch (outcome) {
    case "linked":
      return { ok: true, message: `${name} added to People.` };
    case "already_linked":
      return { ok: true, message: `${name} was already in People.` };
    case "awaiting_staff":
      return {
        ok: true,
        message: `One more step: confirm who ${name} is under "Confirm who they are".`,
      };
    case "not_joined":
      return { ok: false, message: `${name} is no longer a member in the app.` };
    case "account_inactive":
      return { ok: false, message: `${name}'s app account is being closed.` };
  }
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
  embedded = false,
}: {
  people: AppMemberNotInPeople[];
  embedded?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (people.length === 0) return null;

  const add = (accountId: string, name: string) => {
    startTransition(async () => {
      const result = await addAppMemberToPeople({ accountId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const outcome = outcomeMessage(name, result.data.outcome);
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
    });
  };

  const rows = (
    <ul className="flex flex-col gap-3">
      {people.map((person) => {
        const joined = formatFriendlyDate(person.joinedAt);
        const name = person.displayName ?? "Someone from the app";
        return (
          <li
            key={person.accountId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base font-semibold text-foreground">
                {name}
              </span>
              {joined ? (
                <span className="text-sm text-muted-foreground">Joined in the app on {joined}</span>
              ) : null}
            </div>
            <Button disabled={pending} onClick={() => add(person.accountId, name)}>
              Add to People
            </Button>
          </li>
        );
      })}
    </ul>
  );

  if (embedded) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="not-in-people-heading">
        <div className="space-y-1">
          <h3 id="not-in-people-heading" className="font-heading text-lg font-semibold text-foreground">
            In the app, not in People yet ({people.length})
          </h3>
          <p className="text-[15px] text-muted-foreground">
            They joined your church in the app. Add them so they&apos;re on
            the weekly sheet and their check-ins count.
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
          In your app, not in People yet ({people.length})
        </CardTitle>
        <CardDescription className="text-[15px]">
          These members joined your church in the app. Add them so they show
          up here, on the weekly sheet, and so their check-ins count.
        </CardDescription>
      </CardHeader>
      <CardContent>{rows}</CardContent>
    </Card>
  );
}
