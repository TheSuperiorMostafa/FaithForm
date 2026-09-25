"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  createFamilyAndCheckIn,
  type NewFamilyResult,
} from "@/app/dashboard/checkin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { checkInButtonLabel, NEW_FAMILY_MAX_CHILDREN } from "@/lib/checkin/desk";
import type { ChurchLocation } from "@/types/checkin";

type ChildDraft = {
  key: number;
  firstName: string;
  lastName: string;
  locationId: string;
  medicalNotes: string;
};

function emptyChild(key: number, rooms: ChurchLocation[]): ChildDraft {
  return {
    key,
    firstName: "",
    lastName: "",
    locationId: rooms.length === 1 ? rooms[0].id : "",
    medicalNotes: "",
  };
}

/**
 * A first-time family at the desk, in one short form: the parent, then each
 * child with a room and any allergies. "Save and check in" adds them to
 * People as a family and checks the children in, in one step.
 *
 * Only church admins see this form (they are the only people who can add
 * people and families anywhere in the dashboard).
 */
export function NewFamilyForm({
  rooms,
  onDone,
  onCancel,
}: {
  rooms: ChurchLocation[];
  onDone: (result: NewFamilyResult) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [phone, setPhone] = useState("");
  const nextKey = useRef(1);
  const [children, setChildren] = useState<ChildDraft[]>(() => [emptyChild(0, rooms)]);

  const filledChildren = children.filter((child) => child.firstName.trim()).length;
  const dirty =
    Boolean(parentFirst.trim() || parentLast.trim() || phone.trim()) ||
    children.some((child) => child.firstName.trim() || child.medicalNotes.trim());

  function update(key: number, patch: Partial<ChildDraft>) {
    setChildren((current) =>
      current.map((child) => (child.key === key ? { ...child, ...patch } : child)),
    );
  }

  function addChild() {
    const key = nextKey.current++;
    setChildren((current) => [...current, emptyChild(key, rooms)]);
    // Put the cursor in the new child's first name.
    window.setTimeout(() => {
      document.getElementById(`new-child-first-${key}`)?.focus();
    }, 0);
  }

  async function cancel() {
    if (dirty) {
      const discard = await confirmAction({
        title: "Discard this family?",
        description: "What you typed for this family will not be saved.",
        confirmLabel: "Discard family",
        cancelLabel: "Keep typing",
      });
      if (!discard) return;
    }
    onCancel();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createFamilyAndCheckIn({
        guardianFirstName: parentFirst,
        guardianLastName: parentLast,
        guardianPhone: phone,
        children: children.map((child) => ({
          firstName: child.firstName,
          lastName: child.lastName,
          locationId: child.locationId,
          medicalNotes: child.medicalNotes,
        })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone(result.data);
    });
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl flex-col gap-8" noValidate>
        <div className="space-y-1.5">
          <h2 className="font-heading text-2xl font-bold text-foreground">New family</h2>
          <p className="text-base text-muted-foreground">
            For a family visiting for the first time. They are added to People
            as a family, and the children are checked in straight away.
          </p>
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-lg font-semibold text-foreground">Parent or guardian</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-parent-first" className="text-[15px]">First name</Label>
              <Input
                id="new-parent-first"
                autoFocus
                autoComplete="off"
                value={parentFirst}
                onChange={(event) => setParentFirst(event.target.value)}
                className="min-h-12 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-parent-last" className="text-[15px]">Last name</Label>
              <Input
                id="new-parent-last"
                autoComplete="off"
                value={parentLast}
                onChange={(event) => setParentLast(event.target.value)}
                className="min-h-12 text-base"
              />
            </div>
          </div>
          <div className="space-y-2 sm:max-w-sm">
            <Label htmlFor="new-parent-phone" className="text-[15px]">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <PhoneInput
              id="new-parent-phone"
              value={phone}
              onValueChange={setPhone}
              className="min-h-12 text-base"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-lg font-semibold text-foreground">Children</legend>

          {children.map((child, index) => (
            <div
              key={child.key}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-background/60 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-base font-semibold text-foreground">
                  {child.firstName.trim() || `Child ${index + 1}`}
                </p>
                {children.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setChildren((current) => current.filter((row) => row.key !== child.key))
                    }
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`new-child-first-${child.key}`} className="text-[15px]">
                    First name
                  </Label>
                  <Input
                    id={`new-child-first-${child.key}`}
                    autoComplete="off"
                    value={child.firstName}
                    onChange={(event) => update(child.key, { firstName: event.target.value })}
                    className="min-h-12 text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`new-child-last-${child.key}`} className="text-[15px]">
                    Last name{" "}
                    <span className="font-normal text-muted-foreground">
                      (if different)
                    </span>
                  </Label>
                  <Input
                    id={`new-child-last-${child.key}`}
                    autoComplete="off"
                    value={child.lastName}
                    placeholder={parentLast.trim() || undefined}
                    onChange={(event) => update(child.key, { lastName: event.target.value })}
                    className="min-h-12 text-base"
                  />
                </div>
              </div>

              <div className="space-y-2 sm:max-w-sm">
                <Label htmlFor={`new-child-room-${child.key}`} className="text-[15px]">
                  Room
                </Label>
                <Select
                  id={`new-child-room-${child.key}`}
                  value={child.locationId}
                  onChange={(event) => update(child.key, { locationId: event.target.value })}
                  className="min-h-12 text-base"
                >
                  <option value="">Choose a room…</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`new-child-notes-${child.key}`} className="text-[15px]">
                  Allergies or medical notes{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id={`new-child-notes-${child.key}`}
                  value={child.medicalNotes}
                  rows={2}
                  maxLength={1000}
                  placeholder="For example: peanut allergy, has an inhaler"
                  onChange={(event) => update(child.key, { medicalNotes: event.target.value })}
                  className="min-h-[72px] text-base"
                />
              </div>
            </div>
          ))}

          {children.length < NEW_FAMILY_MAX_CHILDREN && (
            <Button type="button" variant="outline" className="self-start" onClick={addChild}>
              <Plus aria-hidden />
              Add another child
            </Button>
          )}
        </fieldset>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[15px] font-medium text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" size="lg" onClick={() => void cancel()}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending} className="min-h-14 text-lg">
            {pending
              ? "Saving…"
              : filledChildren > 0
                ? `Save and ${checkInButtonLabel(filledChildren).toLowerCase()}`
                : "Save and check in"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
