"use client";

import { useState, useTransition } from "react";
import { Home, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createLocation,
  deleteLocation,
  setDefaultAdultLocation,
  updateLocation,
} from "@/app/dashboard/checkin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChurchLocation } from "@/types/checkin";

/**
 * Rooms, as a flat list an admin owns outright.
 *
 * There is no taxonomy to pick from and no minimum. "Nursery" and "Middle
 * School Overflow Room" are the same kind of thing, both typed in here, and a
 * new one is assignable the moment it is saved — which is the acceptance
 * criterion this screen exists to satisfy.
 */
export function LocationsManager({
  locations,
  isAdmin,
}: {
  locations: ChurchLocation[];
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  function submit(
    action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
    formData: FormData,
    successMessage: string,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Add a room</CardTitle>
            {!adding && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAdding(true)}
              >
                <Plus className="mr-1.5 size-3.5" aria-hidden />
                New room
              </Button>
            )}
          </CardHeader>
          {adding && (
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  submit(
                    createLocation,
                    new FormData(form),
                    "Room added.",
                    () => {
                      form.reset();
                      setAdding(false);
                    },
                  );
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="new-location-name">Name</Label>
                  <Input
                    id="new-location-name"
                    name="name"
                    required
                    placeholder="Nursery"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-location-description">
                    Description (optional)
                  </Label>
                  <Input
                    id="new-location-description"
                    name="description"
                    placeholder="Downstairs, past the kitchen"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-location-capacity">Capacity</Label>
                  <Input
                    id="new-location-capacity"
                    name="capacity"
                    type="number"
                    min={1}
                    placeholder="—"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    Add
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
          )}
        </Card>
      )}

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No rooms yet. Add the places your church actually uses — nothing is
            preset, and nothing has to match anyone else&rsquo;s structure.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {locations.map((location) => (
            <Card key={location.id}>
              <CardContent className="py-4">
                <form
                  className="grid gap-3 sm:grid-cols-[2fr_2fr_5rem_5rem_auto] sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    formData.set("locationId", location.id);
                    submit(updateLocation, formData, "Saved.");
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor={`name-${location.id}`}>Name</Label>
                    <Input
                      id={`name-${location.id}`}
                      name="name"
                      defaultValue={location.name}
                      required
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`description-${location.id}`}>
                      Description
                    </Label>
                    <Input
                      id={`description-${location.id}`}
                      name="description"
                      defaultValue={location.description ?? ""}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`capacity-${location.id}`}>Cap.</Label>
                    <Input
                      id={`capacity-${location.id}`}
                      name="capacity"
                      type="number"
                      min={1}
                      defaultValue={location.capacity ?? ""}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`order-${location.id}`}>Order</Label>
                    <Input
                      id={`order-${location.id}`}
                      name="sortOrder"
                      type="number"
                      defaultValue={location.sortOrder}
                      disabled={!isAdmin}
                    />
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={pending}>
                        Save
                      </Button>
                    </div>
                  )}
                </form>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {location.isDefaultAdultLocation ? (
                    <Badge variant="info">
                      <Home className="mr-1 size-3" aria-hidden />
                      Default for adults
                    </Badge>
                  ) : (
                    isAdmin && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          const formData = new FormData();
                          formData.set("locationId", location.id);
                          submit(
                            setDefaultAdultLocation,
                            formData,
                            `Adults now default to ${location.name}.`,
                          );
                        }}
                      >
                        Make the adult default
                      </Button>
                    )
                  )}

                  {!location.isActive && <Badge variant="muted">Switched off</Badge>}

                  {isAdmin && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          const formData = new FormData();
                          formData.set("locationId", location.id);
                          formData.set("name", location.name);
                          formData.set(
                            "description",
                            location.description ?? "",
                          );
                          formData.set(
                            "capacity",
                            location.capacity ? String(location.capacity) : "",
                          );
                          formData.set("sortOrder", String(location.sortOrder));
                          formData.set(
                            "isActive",
                            location.isActive ? "false" : "true",
                          );
                          submit(
                            updateLocation,
                            formData,
                            location.isActive
                              ? "Room switched off — its history is kept."
                              : "Room switched back on.",
                          );
                        }}
                      >
                        {location.isActive ? "Switch off" : "Switch on"}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        className="text-destructive"
                        onClick={() => {
                          const formData = new FormData();
                          formData.set("locationId", location.id);
                          submit(deleteLocation, formData, "Room deleted.");
                        }}
                      >
                        <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Deleting a room with check-ins behind it is refused — switch it off
        instead. It stops being assignable and every past record survives.
      </p>
    </div>
  );
}
