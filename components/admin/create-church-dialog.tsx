"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { createChurchAndInvite } from "@/app/admin/actions";
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

export function CreateChurchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("timezone", timezone);

    startTransition(async () => {
      const result = await createChurchAndInvite(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Invite sent to ${result.email}`);
      setOpen(false);
      setTimezone("America/New_York");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            Create a new church workspace and send an onboarding invite to its
            first admin.
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
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-6 mt-6">
            <Button type="submit" disabled={pending}>
              <Mail className="size-4" strokeWidth={1.75} />
              {pending ? "Sending…" : "Create & Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
