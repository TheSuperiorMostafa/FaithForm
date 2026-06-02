"use client";

import { useState, useTransition } from "react";
import { updateStatementSettings } from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StatementSettings({
  ein,
  statementAddress,
}: {
  ein: string | null;
  statementAddress: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [einValue, setEinValue] = useState(ein ?? "");
  const [address, setAddress] = useState(statementAddress ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    startTransition(async () => {
      const result = await updateStatementSettings({
        ein: einValue.trim() || null,
        statementAddress: address.trim() || null,
      });
      setMessage(result.error ?? "Statement settings saved.");
    });
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">Year-end statements</h4>
        <p className="text-xs text-muted-foreground">
          EIN and address appear on donor tax statements (IRS Form 990 language included).
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ein">EIN (Tax ID)</Label>
        <Input
          id="ein"
          value={einValue}
          onChange={(e) => setEinValue(e.target.value)}
          placeholder="12-3456789"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="stmt-address">Statement address</Label>
        <Input
          id="stmt-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, ST 12345"
        />
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <Button type="button" disabled={pending} onClick={save}>
        Save statement settings
      </Button>
    </div>
  );
}
