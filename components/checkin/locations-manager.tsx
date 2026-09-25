"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, DoorClosed, DoorOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  checkLocationDeletion,
  createLocation,
  deleteLocation,
  reorderLocations,
  setDefaultAdultLocation,
  updateLocation,
} from "@/app/dashboard/checkin/actions";
import { Button } from "@/components/ui/button";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROOMS_DESCRIPTION, ROOMS_TITLE } from "@/components/checkin/copy";
import { joinNames, occupancyLabel } from "@/lib/checkin/desk";
import type { ChurchLocation } from "@/types/checkin";

type ActionResultLike = { ok: boolean; error?: string };

function RoomFields({
  idPrefix,
  room,
}: {
  idPrefix: string;
  room?: ChurchLocation;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-[15px]">Room name</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          defaultValue={room?.name ?? ""}
          placeholder="Nursery"
          className="min-h-12 text-base"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-capacity`} className="text-[15px]">
          Room for <span className="font-normal text-muted-foreground">(children, optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-capacity`}
          name="capacity"
          type="number"
          inputMode="numeric"
          min={1}
          defaultValue={room?.capacity ?? ""}
          placeholder="12"
          className="min-h-12 text-base"
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-description`} className="text-[15px]">
          Where it is <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={room?.description ?? ""}
          placeholder="Downstairs, past the kitchen"
          className="min-h-12 text-base"
        />
      </div>
    </div>
  );
}

/**
 * Rooms, as big cards: who is in each one now, how many it holds, and plain
 * buttons to change it. Nothing is preset: "Nursery" and "Middle School
 * Overflow Room" are the same kind of thing, typed in here, and a new room
 * can be chosen at the desk the moment it is saved.
 */
export function LocationsManager({
  locations,
  occupancy = {},
  isAdmin,
}: {
  locations: ChurchLocation[];
  /** room id → the people checked in there right now. */
  occupancy?: Record<string, string[]>;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  function run(
    action: () => Promise<ActionResultLike>,
    successMessage: string,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      toast.success(successMessage);
      onDone?.();
    });
  }

  function formFor(location: ChurchLocation, overrides: Record<string, string> = {}) {
    const formData = new FormData();
    formData.set("locationId", location.id);
    formData.set("name", location.name);
    formData.set("description", location.description ?? "");
    formData.set("capacity", location.capacity ? String(location.capacity) : "");
    formData.set("sortOrder", String(location.sortOrder));
    formData.set("isActive", location.isActive ? "true" : "false");
    for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
    return formData;
  }

  function setOpen(location: ChurchLocation, open: boolean) {
    run(
      () => updateLocation(formFor(location, { isActive: open ? "true" : "false" })),
      open
        ? `${location.name} is open. Children can be checked in to it.`
        : `${location.name} is closed. Its history is kept.`,
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= locations.length) return;
    const ids = locations.map((location) => location.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(
      () => reorderLocations(ids),
      `${locations[index].name} moved ${direction < 0 ? "up" : "down"}.`,
    );
  }

  async function remove(location: ChurchLocation) {
    const check = await checkLocationDeletion(location.id);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    if (!check.data.canDelete) {
      // A room with history can't be deleted; closing it is what people want.
      const close = await confirmAction({
        title: `${location.name} can't be deleted`,
        description: `It has ${check.data.sessions} check-in${check.data.sessions === 1 ? "" : "s"} on record${
          check.data.defaultFor > 0
            ? ` and is the usual room for ${check.data.defaultFor} ${check.data.defaultFor === 1 ? "child" : "children"}`
            : ""
        }. Close it instead: that keeps its history and stops new check-ins.`,
        confirmLabel: location.isActive ? "Close room" : "Keep it closed",
        cancelLabel: "Go back",
      });
      if (close && location.isActive) setOpen(location, false);
      return;
    }

    const confirmed = await confirmAction({
      title: `Delete ${location.name}?`,
      description: "This room has never been used, so nothing else is lost. This can't be undone.",
      confirmLabel: "Delete room",
      destructive: true,
    });
    if (!confirmed) return;

    const formData = new FormData();
    formData.set("locationId", location.id);
    run(() => deleteLocation(formData), `${location.name} deleted.`);
  }

  const adultRoom = locations.find((location) => location.isDefaultAdultLocation);

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title={ROOMS_TITLE}
        description={ROOMS_DESCRIPTION}
        action={
          isAdmin && !adding ? (
            <Button type="button" size="lg" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add a room
            </Button>
          ) : undefined
        }
      />

      {isAdmin && adding && (
        <Card className="p-6">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              const name = String(formData.get("name") ?? "").trim();
              run(() => createLocation(formData), `${name || "Room"} added.`, () => {
                form.reset();
                setAdding(false);
              });
            }}
          >
            <h3 className="font-heading text-xl font-bold text-foreground">Add a room</h3>
            <RoomFields idPrefix="new-room" />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" disabled={pending}>
                Add room
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {locations.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description={
            isAdmin
              ? "Add the rooms children go to, like Nursery, Preschool or Elementary."
              : "A church admin needs to add the rooms children go to."
          }
          action={
            isAdmin && !adding ? (
              <Button type="button" size="lg" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add a room
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {locations.map((location, index) => {
            const here = occupancy[location.id] ?? [];
            const full = location.capacity != null && here.length >= location.capacity;

            return (
              <Card key={location.id} className="flex flex-col gap-5 p-6">
                {editing === location.id ? (
                  <form
                    className="flex flex-col gap-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formData = new FormData(event.currentTarget);
                      formData.set("locationId", location.id);
                      formData.set("sortOrder", String(location.sortOrder));
                      formData.set("isActive", location.isActive ? "true" : "false");
                      run(() => updateLocation(formData), "Room saved.", () => setEditing(null));
                    }}
                  >
                    <RoomFields idPrefix={`room-${location.id}`} room={location} />
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={pending}>
                        Save room
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <h3 className="font-heading text-2xl font-bold text-foreground">
                          {location.name}
                        </h3>
                        {location.description && (
                          <p className="text-[15px] text-muted-foreground">{location.description}</p>
                        )}
                      </div>
                      {location.isActive ? (
                        <StatusBadge tone={full ? "attention" : "ready"}>
                          {full ? "Full" : "Open"}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Closed</StatusBadge>
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-foreground">
                        {occupancyLabel(here.length, location.capacity)}
                      </p>
                      <p className="text-[15px] text-muted-foreground">
                        {here.length > 0 ? joinNames(here) : "Nobody is in this room right now."}
                      </p>
                    </div>
                  </>
                )}

                {isAdmin && editing !== location.id && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-5">
                    <Button type="button" variant="outline" onClick={() => setEditing(location.id)}>
                      <Pencil aria-hidden />
                      Edit room
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setOpen(location, !location.isActive)}
                    >
                      {location.isActive ? <DoorClosed aria-hidden /> : <DoorOpen aria-hidden />}
                      {location.isActive ? "Close room" : "Open room"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden />
                      Move up
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending || index === locations.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden />
                      Move down
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      className="text-destructive hover:text-destructive"
                      onClick={() => void remove(location)}
                    >
                      <Trash2 aria-hidden />
                      Delete room
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {isAdmin && locations.length > 0 && (
        <AdvancedSection
          title="More options"
          description="Rarely needed. The order above is the order rooms appear at the desk."
        >
          <div className="flex flex-col gap-3">
            <Label htmlFor="adult-room" className="text-[15px] font-semibold">
              Room for adults
            </Label>
            <p className="text-[15px] text-muted-foreground">
              Kids Check-in only checks in children. If your church also records
              adults in a room, like the main hall, choose it here so it is
              picked for them by default.
            </p>
            <Select
              id="adult-room"
              className="sm:max-w-sm"
              value={adultRoom?.id ?? ""}
              disabled={pending}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) return;
                const formData = new FormData();
                formData.set("locationId", id);
                const name = locations.find((location) => location.id === id)?.name ?? "That room";
                run(() => setDefaultAdultLocation(formData), `${name} is now the room for adults.`);
              }}
            >
              <option value="" disabled>
                Not set
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </div>
        </AdvancedSection>
      )}
    </div>
  );
}
