"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchPicker, type PickerItem } from "@/components/ui/search-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { peopleDirectory } from "@/app/dashboard/groups/actions";
import { cn } from "@/lib/utils";
import { Notice } from "./shared";

type Directory = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: PickerItem[]; truncated: boolean };

/**
 * The church's People roster for the picker, loaded once when the dialog
 * opens. With a group, people already in it are shown but can't be chosen.
 */
export function usePeopleDirectory(groupId: string | null) {
  const [directory, setDirectory] = useState<Directory>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setDirectory({ status: "loading" });
    peopleDirectory(groupId).then(result => {
      if (!live) return;
      if (!result.ok) { setDirectory({ status: "error", message: result.error }); return; }
      setDirectory({
        status: "ready",
        truncated: result.data.truncated,
        items: result.data.people.map(p => ({
          id: p.memberId,
          label: p.name,
          description: p.hasApp ? "On the app" : "Not on the app yet",
          disabled: p.inGroup,
          disabledReason: p.inGroup ? "Already in this group" : undefined,
        })),
      });
    }).catch(() => { if (live) setDirectory({ status: "error", message: "We couldn’t load your people. Check your connection and try again." }); });
    return () => { live = false; };
  }, [groupId, attempt]);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { directory, retry };
}

/**
 * Choose people, then (optionally) tap the ones who lead. Chosen people stay
 * visible as chips whatever is typed in the search box.
 */
export function PeopleChooser({ directory, retry, value, onChange, leaders, onLeadersChange, label, autoFocus = false }: {
  directory: Directory; retry: () => void;
  value: string[]; onChange: (ids: string[]) => void;
  leaders: string[]; onLeadersChange: (ids: string[]) => void;
  label: string; autoFocus?: boolean;
}) {
  const items = useMemo(() => directory.status === "ready" ? directory.items : [], [directory]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const chosen = value.map(id => byId.get(id)).filter((i): i is PickerItem => Boolean(i));

  if (directory.status === "loading") {
    return <div className="space-y-3" role="status" aria-label="Loading your people">
      <p className="text-[15px] font-semibold text-foreground">{label}</p>
      <Skeleton className="h-12 w-full rounded-xl" />
      <span className="sr-only">Loading your people…</span>
    </div>;
  }
  if (directory.status === "error") {
    return <div className="space-y-3"><Notice>{directory.message}</Notice><Button type="button" variant="outline" onClick={retry}><RotateCcw className="size-5" aria-hidden />Load people again</Button></div>;
  }
  if (!items.length) {
    return <Notice tone="info">There’s no one in People yet. Add people in the People page first, then come back to add them here.</Notice>;
  }

  return <div className="space-y-6">
    <SearchPicker
      multiple
      autoFocus={autoFocus}
      label={label}
      placeholder="Type a name, like Maria"
      items={items}
      value={value}
      onChange={ids => { onChange(ids); onLeadersChange(leaders.filter(id => ids.includes(id))); }}
    />
    {directory.truncated && <p className="text-sm text-muted-foreground">Only the first 5,000 people are listed. Type more of a name to narrow the list.</p>}
    {chosen.length > 0 && <fieldset className="space-y-3">
      <legend className="text-[15px] font-semibold text-foreground">Who leads it? <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <p className="text-sm text-muted-foreground">Tap anyone who leads this group. Leaders can take attendance and look after the group’s chat.</p>
      <div className="flex flex-wrap gap-2">
        {chosen.map(person => {
          const on = leaders.includes(person.id);
          return <button type="button" key={person.id} aria-pressed={on} onClick={() => onLeadersChange(on ? leaders.filter(id => id !== person.id) : [...leaders, person.id])} className={cn("g-leader-toggle", on && "is-on")}>
            <Star className={cn("size-5", on && "fill-current")} aria-hidden />{person.label}{on && <span className="g-leader-word">Leader</span>}
          </button>;
        })}
      </div>
    </fieldset>}
  </div>;
}
