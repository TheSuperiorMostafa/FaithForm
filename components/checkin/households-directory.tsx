"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { createHousehold } from "@/app/dashboard/checkin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HouseholdSummary } from "@/types/checkin";

type Props = {
  households: HouseholdSummary[];
  /** member id → household id, so a name search can reach the family. */
  householdByPersonName: { name: string; householdId: string }[];
  isAdmin: boolean;
  unassignedCount: number;
};

/**
 * The directory, searched the way a front desk actually searches it.
 *
 * Typing "John Doe" matches the *person* and returns the household — which is
 * the whole point of the feature, and the reason this does not simply filter
 * household names. A child whose surname differs from the household's would be
 * invisible to a name filter, and that child is exactly who someone is looking
 * for.
 */
export function HouseholdsDirectory({
  households,
  householdByPersonName,
  isAdmin,
  unassignedCount,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return households;

    const matchedHouseholdIds = new Set(
      householdByPersonName
        .filter((entry) => entry.name.toLowerCase().includes(term))
        .map((entry) => entry.householdId),
    );

    return households.filter(
      (household) =>
        matchedHouseholdIds.has(household.id) ||
        household.name.toLowerCase().includes(term),
    );
  }, [households, householdByPersonName, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-2">
          <Label htmlFor="household-search" className="flex items-center gap-1.5">
            <Search className="size-3.5" aria-hidden />
            Search by anyone&rsquo;s name
          </Label>
          <Input
            id="household-search"
            value={search}
            placeholder="John Doe"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {isAdmin && !adding && (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            New household
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardHeader>
            <CardTitle>New household</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-[2fr_3fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const formData = new FormData(form);
                startTransition(async () => {
                  const result = await createHousehold(formData);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Household created.");
                  form.reset();
                  setAdding(false);
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="household-name">Name</Label>
                <Input
                  id="household-name"
                  name="name"
                  required
                  placeholder="The Doe Household"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="household-notes">Notes (optional)</Label>
                <Input id="household-notes" name="notes" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  Create
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {search.trim()
              ? "Nobody by that name is in a household yet."
              : "No households yet. Create one, then add people to it."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((household) => (
            <Link
              key={household.id}
              href={`/dashboard/checkin/households/${household.id}`}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent"
            >
              <p className="font-heading text-base font-semibold">
                {household.name}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden />
                {household.memberCount}{" "}
                {household.memberCount === 1 ? "person" : "people"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="muted">
                  {household.guardianCount} guardian
                  {household.guardianCount === 1 ? "" : "s"}
                </Badge>
                {household.dependentCount > 0 && (
                  <Badge variant="info">
                    {household.dependentCount}{" "}
                    {household.dependentCount === 1 ? "child" : "children"}
                  </Badge>
                )}
                {household.guardianCount === 0 && (
                  <Badge variant="warning">No guardian</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {unassignedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {unassignedCount}{" "}
          {unassignedCount === 1 ? "person is" : "people are"} not in a household
          yet. They can still be checked in — they just have no pickup
          credential, so releasing them needs a staff override.
        </p>
      )}
    </div>
  );
}
