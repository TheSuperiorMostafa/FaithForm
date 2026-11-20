"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchPicker, type PickerItem } from "@/components/ui/search-picker";
import type { Leader, PersonOption } from "@/lib/service-plans/types";

export type PositionOption = { id: string; name: string; label: string };

const toKey = (l: Pick<Leader, "personId" | "teamPositionId">) =>
  l.personId ? `p:${l.personId}` : `t:${l.teamPositionId}`;

/**
 * Who leads an item: people, or open positions to fill later. The row chip and
 * the item panel both open this, and both save through the same action.
 */
export function LeadersDialog({
  open,
  onOpenChange,
  itemTitle,
  value,
  people,
  positions,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemTitle: string;
  value: Leader[];
  people: PersonOption[];
  positions: PositionOption[];
  onSave: (leaders: Leader[]) => void;
}) {
  const [keys, setKeys] = useState<string[]>(() => value.map(toKey));
  useEffect(() => {
    if (open) setKeys(value.map(toKey));
  }, [open, value]);

  const items: PickerItem[] = useMemo(
    () => [
      ...people.map((p) => ({ id: `p:${p.id}`, label: p.name })),
      ...positions.map((p) => ({ id: `t:${p.id}`, label: `Open position: ${p.label}` })),
    ],
    [people, positions],
  );
  const labels = useMemo(() => new Map(items.map((i) => [i.id, i.label])), [items]);

  const toLeaders = (): Leader[] =>
    keys.map((key) => {
      const [kind, id] = [key.slice(0, 1), key.slice(2)];
      if (kind === "p") {
        const person = people.find((p) => p.id === id);
        return { personId: id, teamPositionId: null, name: person?.name ?? "Someone", positionLabel: null, photoUrl: person?.photoUrl ?? null };
      }
      const position = positions.find((p) => p.id === id);
      return { personId: null, teamPositionId: id, name: position?.name ?? "Open position", positionLabel: position?.label ?? null, photoUrl: null };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Who leads {itemTitle}</DialogTitle>
          <DialogDescription>Pick people, or an open position when you don’t know who yet.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-auto space-y-5 overflow-y-auto px-6 py-5">
          <SearchPicker
            label="Leaders"
            items={items}
            value={keys}
            onChange={setKeys}
            multiple
            placeholder="Type a name or a position…"
            emptyText="No one or no position matches that."
            autoFocus
          />
          {keys.length > 1 && (
            <div className="space-y-2">
              <p className="text-[15px] font-semibold">Order</p>
              <ol className="flex flex-col gap-2">
                {keys.map((key, i) => (
                  <li key={key} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-4">
                    <span className="truncate text-[15px]">
                      {i + 1}. {labels.get(key) ?? "Leader"}
                    </span>
                    {i > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setKeys((all) => {
                            const next = [...all];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            return next;
                          })
                        }
                      >
                        <ArrowUp aria-hidden />
                        Move up
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(toLeaders());
              onOpenChange(false);
            }}
          >
            Save leaders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Avatar chips for a row: photos or initials, dashed for an open position. */
export function LeaderChips({ leaders, max = 3 }: { leaders: Leader[]; max?: number }) {
  if (!leaders.length) return <span className="text-sm text-muted-foreground">Add leader</span>;
  const shown = leaders.slice(0, max);
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((l, i) => {
        const initials = l.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]?.toUpperCase())
          .join("");
        const open = !l.personId;
        return (
          <span
            key={`${l.personId ?? l.teamPositionId}-${i}`}
            title={open ? `Open: ${l.positionLabel ?? l.name}` : l.name}
            className={
              open
                ? "flex size-9 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/60 bg-background text-xs font-bold text-muted-foreground"
                : "flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-card bg-primary/10 text-xs font-bold text-primary dark:bg-accent/20 dark:text-accent"
            }
          >
            {l.photoUrl && !open ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.photoUrl} alt="" className="size-full object-cover" />
            ) : (
              initials || "?"
            )}
          </span>
        );
      })}
      {leaders.length > max && (
        <span className="flex size-9 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-bold">
          +{leaders.length - max}
        </span>
      )}
      <span className="sr-only">
        Led by {leaders.map((l) => (l.personId ? l.name : `open position ${l.positionLabel ?? l.name}`)).join(", ")}
      </span>
    </span>
  );
}
