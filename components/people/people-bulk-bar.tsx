"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, X } from "lucide-react";
import { toast } from "sonner";

import { bulkUpdateMembers } from "@/app/dashboard/people/actions";
import {
  addPeopleToFamily,
  listFamiliesForPicker,
} from "@/app/dashboard/people/household-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import {
  MEMBER_GENDERS,
  MEMBERSHIP_STATUSES,
  type MemberGender,
  type MembershipStatus,
} from "@/lib/people/membership-status";
import type { ChurchMember } from "@/lib/queries/members";
import { RELATIONSHIP_LABELS, type HouseholdRelationship } from "@/types/checkin";

/**
 * The bar shown while people are selected on the People list: change status
 * or gender for everyone at once, or put them all in the same family.
 */
export function PeopleBulkBar({
  selected,
  isAdmin,
  onClear,
  onUpdated,
}: {
  selected: ChurchMember[];
  isAdmin: boolean;
  onClear: () => void;
  onUpdated: (ids: string[], patch: Partial<ChurchMember>) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [familyOpen, setFamilyOpen] = useState(false);
  const count = selected.length;
  const ids = selected.map((member) => member.id);

  function applyStatus(value: string) {
    if (!value) return;
    const membershipStatus = value as MembershipStatus;
    startTransition(async () => {
      const result = await bulkUpdateMembers({ memberIds: ids, membershipStatus });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const label = MEMBERSHIP_STATUSES.find((status) => status.value === membershipStatus)?.label;
      toast.success(`${result.updated} ${result.updated === 1 ? "person" : "people"} set to ${label}.`);
      onUpdated(ids, { membership_status: membershipStatus });
    });
  }

  function applyGender(value: string) {
    if (!value) return;
    const gender = value === "none" ? "" : (value as MemberGender);
    startTransition(async () => {
      const result = await bulkUpdateMembers({ memberIds: ids, gender });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Gender saved for ${result.updated} ${result.updated === 1 ? "person" : "people"}.`);
      onUpdated(ids, { gender: gender || null });
    });
  }

  if (count === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Change selected people"
        className="fixed inset-x-0 bottom-20 z-40 px-3 sm:bottom-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:flex-wrap sm:items-center">
          <p className="text-base font-semibold" aria-live="polite">
            {count} selected
          </p>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              aria-label="Change status for selected people"
              value=""
              disabled={pending}
              onChange={(event) => applyStatus(event.target.value)}
              className="min-h-11 w-auto"
            >
              <option value="">Change status…</option>
              {MEMBERSHIP_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Change gender for selected people"
              value=""
              disabled={pending}
              onChange={(event) => applyGender(event.target.value)}
              className="min-h-11 w-auto"
            >
              <option value="">Change gender…</option>
              {MEMBER_GENDERS.map((gender) => (
                <option key={gender.value} value={gender.value}>
                  {gender.label}
                </option>
              ))}
              <option value="none">Not set</option>
            </Select>
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setFamilyOpen(true)}
              >
                <Home aria-hidden />
                Add to the same family
              </Button>
            ) : null}
          </div>
          <Button type="button" variant="ghost" onClick={onClear} disabled={pending}>
            <X aria-hidden />
            Clear selection
          </Button>
        </div>
      </div>

      {familyOpen ? (
        <SameFamilyDialog
          open={familyOpen}
          onOpenChange={setFamilyOpen}
          selected={selected}
          onDone={() => {
            setFamilyOpen(false);
            onClear();
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function SameFamilyDialog({
  open,
  onOpenChange,
  selected,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ChurchMember[];
  onDone: () => void;
}) {
  const [families, setFamilies] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [familyId, setFamilyId] = useState<string[]>([]);
  const firstLast = selected.find((member) => member.last_name.trim())?.last_name.trim();
  const [name, setName] = useState(firstLast ? `${firstLast} family` : "");
  const [relationship, setRelationship] = useState<HouseholdRelationship>("other");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void listFamiliesForPicker().then((result) => {
      if (!active) return;
      if (result.ok) setFamilies(result.data);
      else setLoadError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);

  function submit() {
    startTransition(async () => {
      const result = await addPeopleToFamily({
        memberIds: selected.map((member) => member.id),
        relationship,
        ...(mode === "existing" ? { householdId: familyId[0] ?? "" } : { newFamilyName: name }),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { added, alreadyInFamily } = result.data;
      toast.success(
        `${added} ${added === 1 ? "person" : "people"} added to the family.` +
          (alreadyInFamily > 0
            ? ` ${alreadyInFamily} already ${alreadyInFamily === 1 ? "belongs" : "belong"} to another family and ${alreadyInFamily === 1 ? "was" : "were"} left there.`
            : ""),
      );
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent aria-labelledby="same-family-title" onRequestClose={() => !pending}>
        <DialogHeader>
          <DialogTitle id="same-family-title">Add {selected.length} people to the same family</DialogTitle>
          <DialogDescription>
            Someone already in a family stays where they are.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-auto flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto p-6">
            <div role="radiogroup" aria-label="Which family" className="flex flex-wrap gap-2">
              {(["new", "existing"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={
                    "min-h-11 rounded-full border px-5 text-[15px] font-semibold transition-colors " +
                    (mode === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-accent")
                  }
                >
                  {value === "new" ? "New family" : "A family you already have"}
                </button>
              ))}
            </div>

            {mode === "new" ? (
              <div className="space-y-2">
                <Label htmlFor="same-family-name" className="text-base">Family name</Label>
                <Input
                  id="same-family-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            ) : loadError ? (
              <p role="alert" className="text-sm text-destructive">{loadError}</p>
            ) : (
              <SearchPicker
                label="Which family?"
                items={(families ?? []).map((family) => ({ id: family.id, label: family.name }))}
                value={familyId}
                onChange={setFamilyId}
                placeholder={families ? "Start typing the family name…" : "Loading families…"}
              />
            )}

            <div className="space-y-2">
              <Label htmlFor="same-family-role" className="text-base">How they belong</Label>
              <Select
                id="same-family-role"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value as HouseholdRelationship)}
              >
                {(["guardian", "dependent", "other"] as const).map((value) => (
                  <option key={value} value={value}>
                    {RELATIONSHIP_LABELS[value]}
                  </option>
                ))}
              </Select>
              <p className="text-sm text-muted-foreground">
                You can change each person&apos;s role on the family page afterwards.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || (mode === "existing" ? !familyId[0] : !name.trim())}
            >
              {pending ? "Adding…" : "Add to family"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
