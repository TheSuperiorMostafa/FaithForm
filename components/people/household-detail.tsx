"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";

import {
  addHouseholdMember,
  addPickupAuthorization,
  getHouseholdCredentials,
  removeHouseholdMember,
  revokePickupAuthorization,
  rotateCredentials,
  updateHouseholdMember,
  type HouseholdCredentials,
} from "@/app/dashboard/checkin/actions";
import {
  checkHouseholdDeletion,
  deleteHousehold,
  renameHousehold,
} from "@/app/dashboard/people/household-actions";
import { ContactActions } from "@/components/people/contact-actions";
import {
  FAMILY_ROLE_HINTS,
  familySummary,
  formatWeekOf,
} from "@/components/people/people-format";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Label } from "@/components/ui/label";
import { SearchPicker, type PickerItem } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ChurchMember } from "@/lib/queries/members";
import { formatPhoneDisplay } from "@/lib/people/validate-member";
import {
  HOUSEHOLD_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type HouseholdDetail as HouseholdDetailType,
  type HouseholdMemberRow,
  type HouseholdRelationship,
} from "@/types/checkin";

function personItem(member: ChurchMember, otherFamily?: string): PickerItem {
  const phone = member.phone ? formatPhoneDisplay(member.phone) : null;
  return {
    id: member.id,
    label: `${member.first_name} ${member.last_name}`.trim(),
    description: phone ?? member.email ?? undefined,
    disabled: Boolean(otherFamily),
    disabledReason: otherFamily ? `Already in ${otherFamily}` : undefined,
  };
}

/** What changing someone's role in the family actually changes. */
function roleChangeConsequence(
  name: string,
  from: HouseholdRelationship,
  to: HouseholdRelationship,
): string {
  if (to === "guardian") {
    return `${name} will be able to pick up this family's children and will get the family's pickup code.`;
  }
  if (from === "guardian") {
    return `${name} will no longer be able to pick up this family's children with the family's pickup code.`;
  }
  if (to === "dependent") {
    return `${name} can be checked in with this family, and can't pick anyone up.`;
  }
  return `${name} stays in the family but isn't checked in as a child and can't pick anyone up.`;
}

export function HouseholdDetail({
  household,
  members,
  memberFamilies = {},
  isAdmin,
}: {
  household: HouseholdDetailType;
  /** Everyone in the church, for the "add a person" pickers. */
  members: ChurchMember[];
  /** member id → the name of the family they're already in, if any. */
  memberFamilies?: Record<string, string>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<HouseholdCredentials | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(household.name);
  const [newMember, setNewMember] = useState<string[]>([]);
  const [newPickup, setNewPickup] = useState<string[]>([]);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Relationship pickers are controlled so a cancelled change snaps back.
  const [roles, setRoles] = useState<Record<string, HouseholdRelationship>>(() =>
    Object.fromEntries(household.members.map((m) => [m.id, m.relationship])),
  );

  const inHousehold = new Set(household.members.map((m) => m.memberId));
  const authorized = new Set(household.pickupAuthorizations.map((p) => p.memberId));
  const familyName = household.name;

  const memberById = new Map(members.map((m) => [m.id, m]));
  const addableItems = members
    .filter((m) => !inHousehold.has(m.id))
    .map((m) => personItem(m, memberFamilies[m.id]));
  const pickupItems = members
    .filter((m) => !inHousehold.has(m.id) && !authorized.has(m.id))
    .map((m) => personItem(m));

  function run(
    promise: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      toast.success(successMessage);
      onDone?.();
      router.refresh();
    });
  }

  function showCredentials() {
    startTransition(async () => {
      const result = await getHouseholdCredentials(household.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCredentials(result.data);
    });
  }

  async function changeRole(member: HouseholdMemberRow, next: HouseholdRelationship) {
    const previous = roles[member.id] ?? member.relationship;
    if (next === previous) return;
    const who = member.firstName;
    setRoles((current) => ({ ...current, [member.id]: next }));
    const confirmed = await confirmAction({
      title: `Change ${who} to ${RELATIONSHIP_LABELS[next].toLowerCase()}?`,
      description: roleChangeConsequence(who, previous, next),
      confirmLabel: `Change to ${RELATIONSHIP_LABELS[next].toLowerCase()}`,
      destructive: previous === "guardian",
    });
    if (!confirmed) {
      setRoles((current) => ({ ...current, [member.id]: previous }));
      return;
    }
    const formData = new FormData();
    formData.set("membershipId", member.id);
    formData.set("householdId", household.id);
    formData.set("relationship", next);
    formData.set("relationshipLabel", member.relationshipLabel ?? "");
    formData.set("isPrimaryContact", String(member.isPrimaryContact));
    startTransition(async () => {
      const result = await updateHouseholdMember(formData);
      if (!result.ok) {
        setRoles((current) => ({ ...current, [member.id]: previous }));
        toast.error(result.error ?? `We couldn't change ${who}. Please try again.`);
        return;
      }
      toast.success(`${who} is now listed as ${RELATIONSHIP_LABELS[next].toLowerCase()} in ${familyName}.`);
      router.refresh();
    });
  }

  async function removeMember(member: HouseholdMemberRow) {
    const who = `${member.firstName} ${member.lastName}`.trim();
    const confirmed = await confirmAction({
      title: `Remove ${who} from ${familyName}?`,
      description:
        member.relationship === "guardian"
          ? `${member.firstName} stays in People, but will no longer be able to pick up this family's children with the family's pickup code.`
          : member.relationship === "dependent"
            ? `${member.firstName} stays in People, but can't be checked in with this family until they're added back.`
            : `${member.firstName} stays in People. Only the family link is removed.`,
      confirmLabel: "Remove from family",
      destructive: true,
    });
    if (!confirmed) return;
    const formData = new FormData();
    formData.set("membershipId", member.id);
    formData.set("householdId", household.id);
    run(removeHouseholdMember(formData), `${who} removed from ${familyName}.`);
  }

  async function revokePickup(person: HouseholdDetailType["pickupAuthorizations"][number]) {
    const who = `${person.firstName} ${person.lastName}`.trim();
    const confirmed = await confirmAction({
      title: `Stop ${who} picking up children?`,
      description: `${who} will no longer be allowed to pick up children from ${familyName}, starting right away. The family's own parents and guardians aren't affected.`,
      confirmLabel: "Remove pickup permission",
      destructive: true,
    });
    if (!confirmed) return;
    const formData = new FormData();
    formData.set("authorizationId", person.id);
    formData.set("householdId", household.id);
    run(
      revokePickupAuthorization(formData),
      `${who} can no longer pick up children from ${familyName}.`,
    );
  }

  async function replaceCode() {
    const confirmed = await confirmAction({
      title: `Replace the pickup code for ${familyName}?`,
      description:
        "Every parent's current code and QR stop working right away. Use this if a phone is lost or someone should no longer pick up. They'll need the new code next time.",
      confirmLabel: "Replace pickup code",
      destructive: true,
    });
    if (!confirmed) return;
    const formData = new FormData();
    formData.set("householdId", household.id);
    run(
      rotateCredentials(formData),
      "Pickup code replaced. The old code and QR no longer work.",
      () => setCredentials(null),
    );
  }

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the family a name.");
      return;
    }
    startTransition(async () => {
      const result = await renameHousehold({ householdId: household.id, name: trimmed });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Family renamed to ${trimmed}.`);
      setRenaming(false);
      router.refresh();
    });
  }

  async function startDelete() {
    setDeleting(true);
    try {
      const check = await checkHouseholdDeletion(household.id);
      if (!check.ok) {
        toast.error(check.error);
        return;
      }
      if (!check.data.canDelete) {
        setDeleteBlocked(true);
        return;
      }
      const confirmed = await confirmAction({
        title: `Delete ${familyName}?`,
        description: `This permanently deletes the family, its pickup permissions and its pickup code. The ${household.memberCount === 1 ? "person" : `${household.memberCount} people`} in it stay in People. This can't be undone.`,
        confirmLabel: "Delete family",
        destructive: true,
        typeToConfirm: familyName,
      });
      if (!confirmed) return;
      const result = await deleteHousehold({ householdId: household.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${familyName} deleted. The people in it are still in People.`);
      router.push("/dashboard/people/households");
    } catch {
      toast.error("We couldn't delete this family. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href="/dashboard/people/households"
        className="-mb-4 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-[15px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-5" aria-hidden />
        All families
      </Link>

      {renaming ? (
        <form
          className="flex w-full max-w-xl flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveName();
          }}
        >
          <Label htmlFor="family-name" className="text-base">
            Family name
          </Label>
          <Input
            id="family-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Save name
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setName(household.name);
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <PageHeader
          title={familyName}
          description={household.notes?.trim() ? household.notes : familySummary(household)}
          secondary={
            isAdmin ? (
              <Button type="button" variant="outline" onClick={() => setRenaming(true)}>
                <Pencil aria-hidden />
                Rename family
              </Button>
            ) : undefined
          }
        />
      )}

      {household.guardianCount === 0 && household.dependentCount > 0 ? (
        <p className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-[15px] text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-100">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            This family has children but no parent or guardian, so nobody has
            its pickup code. Every child would have to be released without a
            code. Add a parent or guardian below.
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">People in this family</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {household.members.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              No one in this family yet. Add the first person below.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {household.members.map((member) => {
                const who = `${member.firstName} ${member.lastName}`.trim();
                const person = memberById.get(member.memberId);
                const role = roles[member.id] ?? member.relationship;
                return (
                  <li key={member.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                          {who}
                          {member.isPrimaryContact ? (
                            <StatusBadge tone="neutral">Main contact</StatusBadge>
                          ) : null}
                        </p>
                        <p className="text-[15px] text-muted-foreground">
                          {member.relationshipLabel ?? RELATIONSHIP_LABELS[member.relationship]}
                          {member.phone
                            ? ` · ${formatPhoneDisplay(member.phone) ?? member.phone}`
                            : ""}
                        </p>
                        {member.medicalNotes?.trim() ? (
                          <p className="mt-1 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                            <span>{member.medicalNotes}</span>
                          </p>
                        ) : null}
                      </div>

                      {isAdmin ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            aria-label={`${member.firstName}'s role in this family`}
                            value={role}
                            disabled={pending}
                            className="w-auto"
                            onChange={(event) =>
                              changeRole(member, event.target.value as HouseholdRelationship)
                            }
                          >
                            {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                              <option key={value} value={value}>
                                {RELATIONSHIP_LABELS[value]}
                              </option>
                            ))}
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() => removeMember(member)}
                            aria-label={`Remove ${member.firstName} from this family`}
                          >
                            <UserMinus aria-hidden />
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <ContactActions
                      firstName={member.firstName}
                      phone={member.phone ?? person?.phone}
                      email={member.email ?? person?.email}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {isAdmin ? (
            <form
              className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const formData = new FormData(form);
                formData.set("householdId", household.id);
                const chosen = memberById.get(newMember[0] ?? "");
                if (!chosen) {
                  toast.error("Choose a person to add.");
                  return;
                }
                const who = `${chosen.first_name} ${chosen.last_name}`.trim();
                run(addHouseholdMember(formData), `${who} added to ${familyName}.`, () => {
                  form.reset();
                  setNewMember([]);
                });
              }}
            >
              <h3 className="font-heading text-lg font-semibold">Add someone to this family</h3>
              <SearchPicker
                label="Who?"
                name="memberId"
                required
                items={addableItems}
                value={newMember}
                onChange={setNewMember}
                placeholder="Start typing their name…"
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="add-relationship" className="text-base">
                    Parent or guardian, or child?
                  </Label>
                  <Select id="add-relationship" name="relationship" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                      <option key={value} value={value}>
                        {RELATIONSHIP_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-label" className="text-base">
                    How the family says it (optional)
                  </Label>
                  <Input id="add-label" name="relationshipLabel" placeholder="Mom, Grandson" />
                </div>
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                  <li key={value}>
                    <strong className="font-semibold text-foreground">
                      {RELATIONSHIP_LABELS[value]}:
                    </strong>{" "}
                    {FAMILY_ROLE_HINTS[value]}
                  </li>
                ))}
              </ul>
              <Button type="submit" className="self-start" disabled={pending}>
                Add to family
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5" aria-hidden />
            Also allowed to pick up
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Someone outside the family, like a grandparent or a neighbor, who
            this family says may pick up their children.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {household.pickupAuthorizations.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              No one outside the family yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {household.pickupAuthorizations.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-base font-semibold">
                      {person.firstName} {person.lastName}
                    </p>
                    {person.relationshipLabel ? (
                      <p className="text-[15px] text-muted-foreground">
                        {person.relationshipLabel}
                      </p>
                    ) : null}
                  </div>
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => revokePickup(person)}
                    >
                      Remove permission
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {isAdmin ? (
            <form
              className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const formData = new FormData(form);
                formData.set("householdId", household.id);
                const chosen = memberById.get(newPickup[0] ?? "");
                if (!chosen) {
                  toast.error("Choose a person first.");
                  return;
                }
                const who = `${chosen.first_name} ${chosen.last_name}`.trim();
                run(
                  addPickupAuthorization(formData),
                  `${who} can now pick up children from ${familyName}.`,
                  () => {
                    form.reset();
                    setNewPickup([]);
                  },
                );
              }}
            >
              <SearchPicker
                label="Allow someone else to pick up"
                name="memberId"
                required
                items={pickupItems}
                value={newPickup}
                onChange={setNewPickup}
                placeholder="Start typing their name…"
              />
              <div className="flex max-w-md flex-col gap-2">
                <Label htmlFor="pickup-label" className="text-base">
                  Who they are to the family (optional)
                </Label>
                <Input
                  id="pickup-label"
                  name="relationshipLabel"
                  placeholder="Grandmother"
                />
              </div>
              <Button type="submit" className="self-start" disabled={pending}>
                Allow to pick up
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="size-5" aria-hidden />
            This week&rsquo;s pickup code
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Read this out to a parent who can&apos;t open their phone. It
            changes by itself every week.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {credentials ? (
            <div className="space-y-1">
              <p className="font-mono text-4xl font-bold tracking-[0.25em] tabular-nums">
                {credentials.code}
              </p>
              <p className="text-[15px] text-muted-foreground">
                {formatWeekOf(credentials.weekStart) ?? "For this week"}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!credentials ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={showCredentials}
              >
                <KeyRound aria-hidden />
                Show the code
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={replaceCode}
              >
                <RefreshCw aria-hidden />
                Replace pickup code
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {isAdmin ? (
        <AdvancedSection
          title="Delete this family"
          description="Only for a family created by mistake."
          forceOpen={deleteBlocked}
        >
          <div className="flex flex-col gap-4">
            {deleteBlocked ? (
              <p role="status" className="text-[15px] text-foreground">
                {familyName} can&apos;t be deleted because children have been
                checked in with it, and their check-in history needs it. You
                can rename it or remove people from it instead.
              </p>
            ) : (
              <p className="text-[15px] text-muted-foreground">
                The people in it stay in People. Families with check-in history
                can&apos;t be deleted.
              </p>
            )}
            {!deleteBlocked ? (
              <Button
                type="button"
                variant="destructive"
                className="self-start"
                disabled={pending || deleting}
                onClick={startDelete}
              >
                <Trash2 aria-hidden />
                {deleting ? "Checking…" : "Delete family"}
              </Button>
            ) : null}
          </div>
        </AdvancedSection>
      ) : null}
    </div>
  );
}
