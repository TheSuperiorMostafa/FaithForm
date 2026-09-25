"use client";

import { useId, useState } from "react";
import { BellRing, ChevronDown } from "lucide-react";

import { AppMembersNotInPeoplePanel } from "@/components/people/app-members-not-in-people-panel";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { PeopleClaimsPanel } from "@/components/people/people-claims-panel";
import { attentionSummary } from "@/components/people/people-format";
import { Button } from "@/components/ui/button";
import type { AppMemberNotInPeople } from "@/lib/faithform/app-people";
import type { StaffClaimRow } from "@/lib/faithform/people-claims";
import type { ChurchRelationshipRow } from "@/lib/faithform/staff-relationships";
import { cn } from "@/lib/utils";

/**
 * The three "someone in the app needs you" lists, folded into one calm card.
 *
 * They used to be three wordy panels stacked above the list, which pushed the
 * people themselves below the fold. Now the card says how many things are
 * waiting, in one line, and opens on request. Every action inside still
 * works exactly as before.
 */
export function NeedsAttentionCard({
  joinRequests,
  claims,
  notInPeople,
}: {
  joinRequests: ChurchRelationshipRow[];
  claims: StaffClaimRow[];
  notInPeople: AppMemberNotInPeople[];
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const total = joinRequests.length + claims.length + notInPeople.length;

  if (total === 0) return null;

  return (
    <section
      aria-label="Needs your attention"
      className="rounded-2xl border border-amber-200 bg-amber-50/60 shadow-card dark:border-amber-500/30 dark:bg-amber-500/10 dark:shadow-none"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
          >
            <BellRing className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Needs your attention ({total})
            </h2>
            <p className="text-[15px] text-muted-foreground">
              {attentionSummary({
                joinRequests: joinRequests.length,
                claims: claims.length,
                notInPeople: notInPeople.length,
              })}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          className="w-full sm:w-auto"
        >
          {open ? "Hide" : `Review ${total === 1 ? "it" : "them"}`}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-5 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </Button>
      </div>

      {/*
        Kept mounted while closed so a half-filled "add as someone new" form
        survives closing the card and opening it again.
      */}
      <div
        id={regionId}
        className={cn(
          "flex-col gap-8 rounded-b-2xl border-t border-amber-200 bg-card px-5 py-6 sm:px-6 dark:border-amber-500/30",
          open ? "flex" : "hidden",
        )}
      >
        <JoinRequestsPanel requests={joinRequests} embedded />
        <PeopleClaimsPanel claims={claims} embedded />
        <AppMembersNotInPeoplePanel people={notInPeople} embedded />
      </div>
    </section>
  );
}
