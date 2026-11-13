"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMemberGroups, type MemberGroup, type MemberGroupsResult } from "@/app/dashboard/people/group-actions";
import { Button } from "@/components/ui/button";
import { SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

export function MemberGroupList({ groups }: { groups: MemberGroup[] }) {
  return groups.length ? <ul className="flex flex-col gap-1">
    {groups.map(group => <li key={group.id}>
      <Link href={`/dashboard/groups/${group.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2 text-[15px] font-semibold text-primary underline-offset-4 hover:underline dark:text-accent">
        <span className="min-w-0 break-words">{group.name}</span>
        {group.archived ? <span className="shrink-0 text-sm font-normal text-muted-foreground">Archived</span> : null}
      </Link>
    </li>)}
  </ul> : <p className="text-[15px] text-muted-foreground">Not in any groups yet.</p>;
}

export function MemberGroups({ memberId }: { memberId: string }) {
  const [state, setState] = useState<{ memberId: string; result: MemberGroupsResult } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null);
    void getMemberGroups(memberId).then(result => {
      if (active) setState({ memberId, result });
    }).catch(() => {
      if (active) setState({ memberId, result: { ok: false, error: "We couldn't load this person's groups. Try again." } });
    });
    return () => { active = false; };
  }, [memberId, retry]);
  const result = state?.memberId === memberId ? state.result : null;
  if (result?.ok && !result.available) return null;
  return <section aria-label="Groups" className="space-y-3 rounded-2xl border border-border p-4">
    <h3 className="text-base font-semibold">Groups</h3>
    {!result ? <SkeletonContainer label="groups"><SkeletonText lines={2} /></SkeletonContainer>
      : result.ok ? <MemberGroupList groups={result.groups} />
        : <div role="alert" className="space-y-3">
          <p className="text-[15px] text-muted-foreground">{result.error}</p>
          <Button type="button" variant="outline" onClick={() => { setState(null); setRetry(value => value + 1); }}>Try again</Button>
        </div>}
  </section>;
}
