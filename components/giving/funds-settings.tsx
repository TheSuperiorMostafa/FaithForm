"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createGivingFund,
  deleteGivingFund,
  setDefaultFund,
  updateGivingFund,
} from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
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
import { StatusBadge } from "@/components/ui/status-badge";
import type { GivingFundRow } from "@/types/giving";

/**
 * The funds donors choose between on the giving page: add, rename, pick the
 * main one, remove. Removing asks first; past gifts to a removed fund stay in
 * the records.
 */
export function FundsSettings({ funds }: { funds: GivingFundRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<GivingFundRow | null>(null);
  const newId = useId();
  const active = funds.filter((f) => f.isActive);

  const run = (work: () => Promise<{ error?: string }>, success: string) => {
    startTransition(async () => {
      try {
        const result = await work();
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(success);
        router.refresh();
      } catch {
        toast.error("That didn't save. Please try again.");
      }
    });
  };

  const addFund = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const result = await createGivingFund(name);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`${name} added. Donors can choose it on your giving page now.`);
        setNewName("");
        router.refresh();
      } catch {
        toast.error("We couldn't add that fund. Please try again.");
      }
    });
  };

  const remove = async (fund: GivingFundRow) => {
    const ok = await confirmAction({
      title: `Remove ${fund.name}?`,
      description:
        "Donors won't be able to choose it on your giving page or in the app any more. Gifts already given to it stay in your records.",
      confirmLabel: "Remove fund",
      destructive: true,
    });
    if (!ok) return;
    run(() => deleteGivingFund(fund.id), `${fund.name} removed from your giving page.`);
  };

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">Funds</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Donors choose a fund on your giving page. Your main fund is chosen for them unless they
          pick another.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
        {active.map((fund) => (
          <li key={fund.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="truncate text-base font-semibold text-foreground">{fund.name}</span>
              {fund.isDefault && <StatusBadge tone="done">Main fund</StatusBadge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pending} onClick={() => setRenaming(fund)}>
                <Pencil aria-hidden />
                Rename
              </Button>
              {!fund.isDefault && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(() => setDefaultFund(fund.id), `${fund.name} is now your main fund.`)
                  }
                >
                  <Star aria-hidden />
                  Make main fund
                </Button>
              )}
              {!fund.isDefault && active.length > 1 && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void remove(fund)}
                >
                  <Trash2 aria-hidden />
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex max-w-xl flex-col gap-2">
        <Label htmlFor={newId}>Add a fund</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id={newId}
            value={newName}
            maxLength={80}
            placeholder="Youth ministry"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFund();
              }
            }}
          />
          <Button type="button" disabled={pending || !newName.trim()} onClick={addFund}>
            <Plus aria-hidden />
            Add fund
          </Button>
        </div>
      </div>

      {renaming && (
        <RenameFundDialog
          fund={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function RenameFundDialog({
  fund,
  onClose,
  onSaved,
}: {
  fund: GivingFundRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(fund.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === fund.name) {
      onClose();
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateGivingFund(fund.id, { name: trimmed });
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(`${fund.name} is now called ${trimmed}.`);
        onSaved();
      } catch {
        setError("We couldn't rename this fund. Please try again.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent aria-labelledby={`${id}-title`} onRequestClose={() => !pending}>
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle id={`${id}-title`}>Rename {fund.name}</DialogTitle>
            <DialogDescription className="text-[15px]">
              The new name shows on your giving page, in the app and on statements.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6 py-5">
            <Label htmlFor={id}>Fund name</Label>
            <Input
              id={id}
              value={name}
              maxLength={80}
              autoFocus
              aria-invalid={error ? true : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-[15px] font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
