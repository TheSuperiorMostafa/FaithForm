"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ChurchMember } from "@/lib/queries/members";
import {
  HOUSEHOLD_RELATIONSHIPS,
  RELATIONSHIP_DESCRIPTIONS,
  RELATIONSHIP_LABELS,
  type HouseholdDetail as HouseholdDetailType,
} from "@/types/checkin";

export function HouseholdDetail({
  household,
  members,
  isAdmin,
}: {
  household: HouseholdDetailType;
  /** Everyone in the church, for the "add a person" pickers. */
  members: ChurchMember[];
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<HouseholdCredentials | null>(
    null,
  );

  const inHousehold = new Set(household.members.map((m) => m.memberId));
  const authorized = new Set(household.pickupAuthorizations.map((p) => p.memberId));

  function run(
    promise: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      onDone?.();
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

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/checkin/households"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All households
      </Link>

      <div>
        <h2 className="font-heading text-xl font-bold">{household.name}</h2>
        {household.notes && (
          <p className="mt-1 text-sm text-muted-foreground">{household.notes}</p>
        )}
      </div>

      {household.guardianCount === 0 && household.dependentCount > 0 && (
        <p className="flex items-start gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This household has children but no guardian, so nobody holds its
            pickup credential. Every release would need a staff override.
          </span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {household.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody in this household yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {household.members.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {member.firstName} {member.lastName}
                      {member.isPrimaryContact && (
                        <Badge variant="muted" className="ml-2">
                          Primary contact
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {member.relationshipLabel ??
                        RELATIONSHIP_LABELS[member.relationship]}
                      {member.phone && ` · ${member.phone}`}
                    </p>
                    {member.medicalNotes?.trim() && (
                      <p className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span>{member.medicalNotes}</span>
                      </p>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`How ${member.firstName} belongs to this household`}
                        defaultValue={member.relationship}
                        disabled={pending}
                        className="h-10 py-0 text-sm"
                        onChange={(event) => {
                          const formData = new FormData();
                          formData.set("membershipId", member.id);
                          formData.set("householdId", household.id);
                          formData.set("relationship", event.target.value);
                          formData.set(
                            "relationshipLabel",
                            member.relationshipLabel ?? "",
                          );
                          formData.set(
                            "isPrimaryContact",
                            String(member.isPrimaryContact),
                          );
                          run(updateHouseholdMember(formData), "Saved.");
                        }}
                      >
                        {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                          <option key={value} value={value}>
                            {RELATIONSHIP_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={pending}
                        aria-label={`Remove ${member.firstName} from this household`}
                        onClick={() => {
                          const formData = new FormData();
                          formData.set("membershipId", member.id);
                          formData.set("householdId", household.id);
                          run(removeHouseholdMember(formData), "Removed.");
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <form
              className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const formData = new FormData(form);
                formData.set("householdId", household.id);
                run(addHouseholdMember(formData), "Added.", () => form.reset());
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="add-member">Add someone</Label>
                <Select id="add-member" name="memberId" required>
                  <option value="">Choose a person…</option>
                  {members
                    .filter((m) => !inHousehold.has(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.last_name}, {m.first_name}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-relationship">As</Label>
                <Select id="add-relationship" name="relationship" required>
                  {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                    <option key={value} value={value}>
                      {RELATIONSHIP_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-label">Called (optional)</Label>
                <Input id="add-label" name="relationshipLabel" placeholder="Mother" />
              </div>
              <Button type="submit" disabled={pending}>
                Add
              </Button>

              <ul className="col-span-full space-y-0.5 text-xs text-muted-foreground">
                {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                  <li key={value}>
                    <strong className="text-foreground">
                      {RELATIONSHIP_LABELS[value]}
                    </strong>{" "}
                    — {RELATIONSHIP_DESCRIPTIONS[value]}
                  </li>
                ))}
              </ul>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            Also allowed to collect
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Someone outside the household — a grandparent, a neighbour — this
            family has said may pick their children up.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {household.pickupAuthorizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody outside the household is authorized.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {household.pickupAuthorizations.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {person.firstName} {person.lastName}
                    </p>
                    {person.relationshipLabel && (
                      <p className="text-xs text-muted-foreground">
                        {person.relationshipLabel}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("authorizationId", person.id);
                        formData.set("householdId", household.id);
                        run(
                          revokePickupAuthorization(formData),
                          "Authorization removed.",
                        );
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <form
              className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const formData = new FormData(form);
                formData.set("householdId", household.id);
                run(addPickupAuthorization(formData), "Authorized.", () =>
                  form.reset(),
                );
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="add-pickup">Authorize someone</Label>
                <Select id="add-pickup" name="memberId" required>
                  <option value="">Choose a person…</option>
                  {members
                    .filter((m) => !inHousehold.has(m.id) && !authorized.has(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.last_name}, {m.first_name}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pickup-label">Called (optional)</Label>
                <Input
                  id="pickup-label"
                  name="relationshipLabel"
                  placeholder="Grandmother"
                />
              </div>
              <Button type="submit" disabled={pending}>
                Authorize
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            This week&rsquo;s pickup code
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Read this out to a parent who cannot open their phone. It changes
            every week on its own.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {credentials ? (
            <>
              <p className="font-mono text-3xl font-bold tracking-[0.25em] tabular-nums">
                {credentials.code}
              </p>
              <span className="text-xs text-muted-foreground">
                week of {credentials.weekStart}
              </span>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={showCredentials}
            >
              Show the code
            </Button>
          )}

          {isAdmin && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                const formData = new FormData();
                formData.set("householdId", household.id);
                run(
                  rotateCredentials(formData),
                  "Replaced — the old code and QR stop working now.",
                  () => setCredentials(null),
                );
              }}
            >
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
              Replace it
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
