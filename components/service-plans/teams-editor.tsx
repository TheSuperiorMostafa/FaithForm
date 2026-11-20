"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  addPositionAction,
  archiveTeamAction,
  createTeamAction,
  removePositionAction,
  updateTeamAction,
} from "@/app/dashboard/plans/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { undoToast } from "@/lib/ui/undo-toast";
import { NOTE_CATEGORIES, NOTE_CATEGORY_LABELS, type NoteCategory, type Team } from "@/lib/service-plans/types";

function TeamCard({ team }: { team: Team }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(team.name);
  const [position, setPosition] = useState("");

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      if (success) toast.success(success);
      router.refresh();
    });

  const toggleCategory = (category: NoteCategory, on: boolean) => {
    const next = on ? [...team.noteCategories, category] : team.noteCategories.filter((c) => c !== category);
    run(
      () => updateTeamAction(team.id, { noteCategories: next }),
      `${team.name} ${on ? "now sees" : "no longer sees"} ${NOTE_CATEGORY_LABELS[category]} notes.`,
    );
  };

  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`team-name-${team.id}`}>Team name</Label>
          <Input
            id={`team-name-${team.id}`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== team.name) {
                run(() => updateTeamAction(team.id, { name }), `Team renamed to ${name.trim()}.`);
              }
            }}
          />
        </div>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await archiveTeamAction(team.id, true);
              if (!result.ok) return void toast.error(result.error);
              router.refresh();
              undoToast(`${team.name} removed.`, async () => {
                const undo = await archiveTeamAction(team.id, false);
                router.refresh();
                return undo.ok ? undefined : undo.error;
              });
            })
          }
        >
          Remove team
        </Button>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[15px] font-semibold">Positions</legend>
        {team.positions.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">No positions yet, such as Vocals or Sound.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {team.positions.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removePositionAction(p.id), `${p.name} removed from ${team.name}.`)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-[15px] font-semibold hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove position ${p.name}`}
                >
                  {p.name}
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const value = position;
            setPosition("");
            run(() => addPositionAction(team.id, value), `${value.trim()} added to ${team.name}.`);
          }}
        >
          <Label htmlFor={`team-position-${team.id}`} className="sr-only">
            New position
          </Label>
          <Input
            id={`team-position-${team.id}`}
            value={position}
            maxLength={60}
            placeholder="New position, e.g. Keys"
            onChange={(e) => setPosition(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={pending || !position.trim()}>
            <Plus aria-hidden />
            Add position
          </Button>
        </form>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[15px] font-semibold">Notes this team sees</legend>
        <p className="text-sm text-muted-foreground">
          The default for Team view links and prints. You can change it when you share.
        </p>
        <div className="flex flex-wrap gap-2">
          {NOTE_CATEGORIES.map((category) => {
            const on = team.noteCategories.includes(category);
            return (
              <label
                key={category}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-[15px] font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--accent))]"
                  checked={on}
                  disabled={pending}
                  onChange={(e) => toggleCategory(category, e.target.checked)}
                />
                {NOTE_CATEGORY_LABELS[category]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}

export function TeamsEditor({ serviceTypeId, teams }: { serviceTypeId: string; teams: Team[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      {teams.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title="No teams yet"
          description="Teams like Worship, Tech and Welcome, with positions such as Keys or Sound. Leaders on an item can be a person or an open position."
        />
      ) : (
        teams.map((team) => <TeamCard key={team.id} team={team} />)
      )}
      <form
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await createTeamAction(serviceTypeId, name);
            if (!result.ok) return void toast.error(result.error);
            toast.success(`${name.trim()} team added.`);
            setName("");
            router.refresh();
          });
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="new-team-name">New team</Label>
          <Input id="new-team-name" value={name} maxLength={60} placeholder="Kids" onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus aria-hidden />
          Add team
        </Button>
      </form>
    </div>
  );
}
