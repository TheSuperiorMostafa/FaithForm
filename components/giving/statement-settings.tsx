"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateStatementSettings } from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The church details printed on year-end statements. What the statement
 * actually says: the church's name, tax ID and address, each gift, the total,
 * and a note that no goods or services were given in exchange.
 */
export function StatementSettings({
  ein,
  statementAddress,
  suggestedAddress,
}: {
  ein: string | null;
  statementAddress: string | null;
  /** The church's own address from Church info, offered when none is saved. */
  suggestedAddress: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [einValue, setEinValue] = useState(ein ?? "");
  const [address, setAddress] = useState(statementAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const einId = useId();
  const addressId = useId();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateStatementSettings({
          ein: einValue.trim() || null,
          statementAddress: address.trim() || null,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success("Statement details saved. They'll print on every year-end statement.");
        router.refresh();
      } catch {
        setError("We couldn't save your statement details. Please try again.");
      }
    });
  };

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">Statement details</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Printed on each donor&apos;s year-end statement, with a note that nothing was given in
          exchange for their gifts.
        </p>
      </div>
      <form onSubmit={save} className="flex max-w-xl flex-col gap-5">
        <div className="space-y-2">
          <Label htmlFor={einId}>Tax ID (EIN)</Label>
          <Input
            id={einId}
            value={einValue}
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-3456789"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setEinValue(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={addressId}>Address for statements</Label>
          <Input
            id={addressId}
            value={address}
            autoComplete="street-address"
            placeholder={suggestedAddress || "123 Main St, Springfield, IL 62701"}
            onChange={(e) => setAddress(e.target.value)}
          />
          {!address.trim() && suggestedAddress && (
            <Button type="button" variant="ghost" className="h-auto whitespace-normal text-left" onClick={() => setAddress(suggestedAddress)}>
              Use your church&apos;s address: {suggestedAddress}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[15px] font-medium text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            Save statement details
          </Button>
        </div>
      </form>
    </Card>
  );
}
