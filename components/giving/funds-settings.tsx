"use client";

import { useState, useTransition } from "react";
import {
  createGivingFund,
  deleteGivingFund,
  setDefaultFund,
  updateGivingFund,
} from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GivingFundRow } from "@/types/giving";

export function FundsSettings({
  funds,
  className,
}: {
  funds: GivingFundRow[];
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const addFund = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await createGivingFund(newName.trim());
      setMessage(result.error ?? "Fund added.");
      if (!result.error) setNewName("");
    });
  };

  return (
    <div className={cn("space-y-4 border-t pt-4", className)}>
      <div>
        <h4 className="text-sm font-medium">Giving funds</h4>
        <p className="text-xs text-muted-foreground">
          Donors choose a fund on your giving page. At least one fund must remain active.
        </p>
      </div>

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}

      <ul className="space-y-2">
        {funds.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              {f.name}
              {f.isDefault && (
                <span className="ml-2 text-xs text-muted-foreground">(default)</span>
              )}
              {!f.isActive && (
                <span className="ml-2 text-xs text-destructive">(inactive)</span>
              )}
            </span>
            <div className="flex gap-1">
              {!f.isDefault && f.isActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await setDefaultFund(f.id);
                    })
                  }
                >
                  Set default
                </Button>
              )}
              {f.isActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const name = window.prompt("Fund name", f.name);
                      if (name) await updateGivingFund(f.id, { name });
                    })
                  }
                >
                  Rename
                </Button>
              )}
              {f.isActive && funds.filter((x) => x.isActive).length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteGivingFund(f.id);
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="new-fund">New fund</Label>
          <Input
            id="new-fund"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Youth Ministry"
          />
        </div>
        <Button
          type="button"
          className="mt-6"
          disabled={pending}
          onClick={addFund}
        >
          Add fund
        </Button>
      </div>
    </div>
  );
}
