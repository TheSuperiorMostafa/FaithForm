"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  addPlanTeamMemberAction,
  removePlanTeamMemberAction,
  setPlanTeamMemberStatusAction,
} from "@/app/dashboard/plans/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import { undoToast } from "@/lib/ui/undo-toast";
import type { PersonOption, PlanTeamMember, Team, TeamMemberStatus } from "@/lib/service-plans/types";

const STATUS_LABELS: Record<TeamMemberStatus, string> = {
  unconfirmed: "Not confirmed",
  confirmed: "Confirmed",
  declined: "Declined",
};

/** Who serves on this date, by team and position, with their answer. */
export function PlanTeam({
  planId,
  team,
  teams,
  people,
  onChanged,
}: {
  planId: string;
  team: PlanTeamMember[];
  teams: Team[];
  people: PersonOption[];
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [positionId, setPositionId] = useState("");
  const [personIds, setPersonIds] = useState<string[]>([]);
  const positions = useMemo(
    () => teams.flatMap((t) => t.positions.map((p) => ({ id: p.id, label: `${t.name} · ${p.name}` }))),
    [teams],
  );
  const byTeam = useMemo(() => {
    const groups = new Map<string, PlanTeamMember[]>();
    for (const m of team) groups.set(m.teamName, [...(groups.get(m.teamName) ?? []), m]);
    return [...groups.entries()];
  }, [team]);

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      if (success) toast.success(success);
      onChanged();
    });

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="plan-team-title">
      <h2 id="plan-team-title" className="font-heading text-lg font-bold">
        Team for this plan
      </h2>
      {team.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No one is scheduled yet.</p>
      ) : (
        <div className="space-y-4">
          {byTeam.map(([teamName, members]) => (
            <div key={teamName} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{teamName}</h3>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.personName}</span>
                      <span className="block text-sm text-muted-foreground">{m.positionName}</span>
                    </span>
                    <Label htmlFor={`status-${m.id}`} className="sr-only">
                      {m.personName}’s answer
                    </Label>
                    <Select
                      id={`status-${m.id}`}
                      value={m.status}
                      className="w-auto min-w-[150px]"
                      disabled={pending}
                      onChange={(e) =>
                        run(() => setPlanTeamMemberStatusAction(m.id, e.target.value as TeamMemberStatus))
                      }
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Take ${m.personName} off ${m.positionName}`}
                      onClick={() =>
                        start(async () => {
                          const result = await removePlanTeamMemberAction(m.id);
                          if (!result.ok) return void toast.error(result.error);
                          onChanged();
                          undoToast(`${m.personName} taken off ${m.positionName}.`, async () => {
                            const undo = await addPlanTeamMemberAction(planId, m.positionId, m.personId);
                            onChanged();
                            return undo.ok ? undefined : undo.error;
                          });
                        })
                      }
                    >
                      <X aria-hidden />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {positions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add teams and positions on the service type’s Teams tab first.</p>
      ) : adding ? (
        <form
          className="space-y-3 rounded-xl border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!positionId || !personIds[0]) return;
            const person = people.find((p) => p.id === personIds[0]);
            run(
              () => addPlanTeamMemberAction(planId, positionId, personIds[0]),
              `${person?.name ?? "They"} added to the team.`,
            );
            setPersonIds([]);
            setAdding(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="team-add-position">Position</Label>
            <Select id="team-add-position" value={positionId} onChange={(e) => setPositionId(e.target.value)} required>
              <option value="" disabled>
                Pick a position
              </option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <SearchPicker
            label="Person"
            items={people.map((p) => ({ id: p.id, label: p.name }))}
            value={personIds}
            onChange={setPersonIds}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !positionId || !personIds.length}>
              Add to team
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Schedule someone
        </Button>
      )}
    </section>
  );
}
