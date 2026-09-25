"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { updateChurchEin } from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Statements can't be made without the church's tax ID, so when it's
 * missing we ask for it right here instead of sending the person to Settings.
 */
export function EinInlineForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateChurchEin(value);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(`Tax ID ${result.ein} saved. It will print on every statement.`);
        router.refresh();
      } catch {
        setError("We couldn't save your tax ID. Please try again.");
      }
    });
  };

  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-bold text-foreground">
            First, add your church&apos;s tax ID (EIN)
          </h2>
          <p className="text-[15px] leading-relaxed text-foreground/80">
            It&apos;s printed on every statement. It&apos;s the 9-digit number on your church&apos;s
            IRS letter.
          </p>
        </div>
      </div>
      <div className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor={id}>Tax ID (EIN)</Label>
          <Input
            id={id}
            value={value}
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-3456789"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !value.trim()}>
          Save tax ID
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
