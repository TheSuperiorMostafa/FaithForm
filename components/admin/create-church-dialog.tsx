"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { createChurch } from "@/app/admin/actions";
import { TimezoneSelect } from "@/components/admin/timezone-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

type AdminMode = "invite" | "later";

const MODES: Array<{ value: AdminMode; label: string; hint: string }> = [
  {
    value: "invite",
    label: "Invite their admin now",
    hint: "We email them an onboarding link",
  },
  {
    value: "later",
    label: "Set it up ourselves first",
    hint: "Add their admin's email later",
  },
];

export function CreateChurchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [adminMode, setAdminMode] = useState<AdminMode>("invite");
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setTimezone("America/New_York");
    setAdminMode("invite");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("timezone", timezone);

    startTransition(async () => {
      const result = await createChurch(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.email
          ? `Invite sent to ${result.email}`
          : "Church created — invite their admin whenever you have the address.",
      );
      close();
      router.refresh();
      if (!result.email) router.push(`/admin/churches/${result.churchId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" strokeWidth={1.75} />
          Add Church
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add church</DialogTitle>
          <DialogDescription>
            Create a new church workspace, and either invite its first admin now
            or hold the invite until you have their email.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Church name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Grace Community Church"
                required
                className={inputClass}
              />
            </div>

            <div className="sm:col-span-2">
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>First admin</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODES.map((mode) => {
                  const active = adminMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAdminMode(mode.value)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-accent/60 bg-accent/10 shadow-sm"
                          : "border-border bg-background hover:border-accent/40 hover:bg-accent/5",
                      )}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        {mode.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {mode.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {adminMode === "invite" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="adminFirstName">Admin first name</Label>
                  <Input
                    id="adminFirstName"
                    name="adminFirstName"
                    placeholder="Jane"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adminLastName">Admin last name</Label>
                  <Input
                    id="adminLastName"
                    name="adminLastName"
                    placeholder="Smith"
                    required
                    className={inputClass}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="adminEmail">Admin email</Label>
                  <Input
                    id="adminEmail"
                    name="adminEmail"
                    type="email"
                    placeholder="pastor@example.com"
                    required
                    className={inputClass}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground sm:col-span-2">
                The workspace opens straight away for us — profile, features,
                integrations and website all work with no church admin on it.
                When you have the pastor&apos;s email, send their invite from
                this church&apos;s Users tab.
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-6 mt-6">
            <Button type="submit" disabled={pending}>
              {adminMode === "invite" ? (
                <>
                  <Mail className="size-4" strokeWidth={1.75} />
                  {pending ? "Sending…" : "Create & Send Invite"}
                </>
              ) : (
                <>
                  <Plus className="size-4" strokeWidth={1.75} />
                  {pending ? "Creating…" : "Create church"}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
