"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { createHousehold } from "@/app/dashboard/checkin/actions";
import {
  familyStatus,
  familySummary,
} from "@/components/people/people-format";
import { FAMILIES_DESCRIPTION, PeopleTabs } from "@/components/people/people-tabs";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
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
 * Typing "John Doe" matches the *person* and returns the family, which is
 * the whole point of the feature, and the reason this does not simply filter
 * family names. A child whose surname differs from the family's would be
 * invisible to a name filter, and that child is exactly who someone is looking
 * for.
 */
export function HouseholdsDirectory({
  households,
  householdByPersonName,
  isAdmin,
  unassignedCount,
}: Props) {
  const router = useRouter();
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

  const newFamilyButton = isAdmin ? (
    <Button type="button" size="lg" onClick={() => setAdding(true)} disabled={adding}>
      <Plus aria-hidden />
      New family
    </Button>
  ) : null;

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title="Families" description={FAMILIES_DESCRIPTION} action={newFamilyButton} />

      <PeopleTabs />

      {adding ? (
        <Card className="p-6">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const name = formData.get("name")?.toString().trim() ?? "";
              startTransition(async () => {
                const result = await createHousehold(formData);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(`${name || "Family"} created. Now add the people in it.`);
                // Straight into the new family: the next job is adding people.
                router.push(`/dashboard/people/households/${result.data.householdId}`);
              });
            }}
          >
            <h2 className="font-heading text-xl font-bold">New family</h2>
            <div className="flex max-w-xl flex-col gap-2">
              <Label htmlFor="household-name" className="text-base">
                Family name
              </Label>
              <Input
                id="household-name"
                name="name"
                required
                autoFocus
                placeholder="The Lopez family"
              />
            </div>
            <AdvancedSection title="Add a note (optional)">
              <div className="flex max-w-xl flex-col gap-2">
                <Label htmlFor="household-notes" className="text-base">
                  Note for your team
                </Label>
                <Input
                  id="household-notes"
                  name="notes"
                  placeholder="Grandma usually picks up on Wednesdays"
                />
              </div>
            </AdvancedSection>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? "Creating…" : "Create family"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <section aria-label="Find a family" className="flex flex-col gap-5">
        <div className="relative">
          <label htmlFor="household-search" className="sr-only">
            Search families
          </label>
          <Search
            className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id="household-search"
            type="search"
            value={search}
            autoComplete="off"
            placeholder="Search by family name or anyone in it"
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-14 w-full rounded-2xl border-[1.5px] border-border bg-card pl-14 pr-5 text-lg text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </div>

        {households.length === 0 ? (
          <EmptyState
            icon={Home}
            title="No families yet"
            description="Put people who live together in a family, so their children can be checked in and picked up safely."
            action={
              isAdmin && !adding ? (
                <Button type="button" size="lg" onClick={() => setAdding(true)}>
                  <Plus aria-hidden />
                  New family
                </Button>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title={`No family matches “${search.trim()}”`}
            description="Try a first name, a last name or the family's name. Someone not in a family yet won't show up here."
            action={
              <Button type="button" variant="outline" onClick={() => setSearch("")}>
                Show all families
              </Button>
            }
          />
        ) : (
          <List label="Families">
            {visible.map((household) => {
              const status = familyStatus(household);
              return (
                <ListRow
                  key={household.id}
                  href={`/dashboard/people/households/${household.id}`}
                  leading={
                    <span
                      aria-hidden
                      className="flex size-12 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
                    >
                      <Home className="size-6" />
                    </span>
                  }
                  title={household.name}
                  subtitle={familySummary(household)}
                  status={
                    status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : undefined
                  }
                />
              );
            })}
          </List>
        )}

        {unassignedCount > 0 ? (
          <p className="text-[15px] text-muted-foreground">
            {unassignedCount} {unassignedCount === 1 ? "person isn't" : "people aren't"} in
            a family yet. They can still be checked in, but a staff member has
            to release them without a code at pickup.
          </p>
        ) : null}
      </section>
    </div>
  );
}
