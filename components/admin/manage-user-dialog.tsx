"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  initialAdminUserState,
  removeChurchUser,
  updateChurchUserAccess,
} from "@/app/admin/user-actions";
import { FeatureAccessPicker } from "@/components/settings/feature-access-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FeatureKey } from "@/lib/features/catalog";
import type { AdminPlatformUserRow } from "@/lib/queries/admin";
import { cn } from "@/lib/utils";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save access"}
    </Button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Removing…" : "Remove from church"}
    </Button>
  );
}

export function ManageUserDialog({
  user,
  availableFeatures,
  open,
  onOpenChange,
}: {
  user: AdminPlatformUserRow;
  /** Features this church has switched on — the only grantable ones. */
  availableFeatures: FeatureKey[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "viewer">(
    user.role === "admin" ? "admin" : "viewer",
  );
  const [features, setFeatures] = useState<FeatureKey[]>(
    user.featurePermissions ?? [],
  );

  const [updateState, updateAction] = useFormState(
    updateChurchUserAccess,
    initialAdminUserState,
  );
  const [removeState, removeAction] = useFormState(
    removeChurchUser,
    initialAdminUserState,
  );

  useEffect(() => {
    if (updateState.ok || removeState.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [updateState, removeState, onOpenChange, router]);

  const error = updateState.error ?? removeState.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage user</DialogTitle>
          <DialogDescription>
            {user.email ?? user.userId} · {user.churchName}
          </DialogDescription>
        </DialogHeader>

        <form action={updateAction} className="flex min-h-0 flex-col">
          <input type="hidden" name="member_id" value={user.id} />
          <input type="hidden" name="role" value={role} />

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">Role</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "admin" as const,
                      title: "Admin",
                      detail: "Full access, and can manage their own team.",
                    },
                    {
                      value: "viewer" as const,
                      title: "Member",
                      detail: "Only the features you pick below.",
                    },
                  ]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRole(option.value)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      role === option.value
                        ? "border-accent bg-accent/10"
                        : "border-border hover:border-accent/50",
                    )}
                  >
                    <p className="text-sm font-semibold">{option.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {option.detail}
                    </p>
                  </button>
                ))}
              </div>
            </fieldset>

            {role === "admin" ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Admins hold every feature the church has switched on, so there
                is nothing to pick.
              </p>
            ) : (
              <FeatureAccessPicker
                availableFeatures={availableFeatures}
                selected={features}
                onChange={setFeatures}
              />
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <SaveButton />
          </DialogFooter>
        </form>

        <form
          action={removeAction}
          className="border-t border-border px-6 py-4"
        >
          <input type="hidden" name="member_id" value={user.id} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Unlinks them from {user.churchName}. Their FaithForm login is left
              alone.
            </p>
            <RemoveButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
