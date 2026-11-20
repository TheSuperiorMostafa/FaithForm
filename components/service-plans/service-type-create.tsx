"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createServiceTypeAction } from "@/app/dashboard/plans/actions";
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

/** One click: Sunday Morning with a typical order, teams and times. */
export function StarterServiceTypeButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await createServiceTypeAction({ starter: true });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Sunday Morning is ready, with a Standard Sunday template and Worship, Tech and Welcome teams.");
          router.push(`/dashboard/plans/${result.id}`);
        })
      }
    >
      <Sparkles aria-hidden className="size-5" />
      {pending ? "Setting up Sunday Morning…" : "Start with Sunday Morning"}
    </Button>
  );
}

export function NewServiceTypeCard({ variant }: { variant: "card" | "button" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await createServiceTypeAction({ name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${name.trim()} added. Set its times under Settings.`);
      setOpen(false);
      router.push(`/dashboard/plans/${result.id}?tab=settings`);
    });
  };

  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-full min-h-[168px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card/60 p-5 text-center font-semibold text-primary transition-colors hover:border-accent/60 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
        >
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-2xl bg-primary/[0.07] dark:bg-accent/15"
          >
            <Plus className="size-6" />
          </span>
          New service type
        </button>
      ) : (
        <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
          <Plus aria-hidden className="size-5" />
          Name my own
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
            <DialogHeader>
              <DialogTitle>New service type</DialogTitle>
              <DialogDescription>
                A kind of service you plan again and again, such as Sunday Evening or Wednesday Night.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-auto space-y-2 overflow-y-auto px-6 py-5">
              <Label htmlFor="service-type-name">Name</Label>
              <Input
                id="service-type-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="Wednesday Night"
                maxLength={80}
                autoFocus
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "service-type-error" : undefined}
              />
              {error && (
                <p id="service-type-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Adding…" : "Add service type"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
