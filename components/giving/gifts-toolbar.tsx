"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GivingFundRow } from "@/types/giving";

export function GiftsToolbar({ funds }: { funds: GivingFundRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`/dashboard/giving/gifts?${params.toString()}`);
    });
  };

  const exportCsv = () => {
    const qs = searchParams.toString();
    window.location.href = `/api/dashboard/giving/export?${qs}`;
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="search">Search donor</Label>
          <Input
            id="search"
            placeholder="Name or email"
            defaultValue={searchParams.get("search") ?? ""}
            onBlur={(e) => updateParams({ search: e.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fund">Fund</Label>
          <select
            id="fund"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={searchParams.get("fundId") ?? ""}
            onChange={(e) =>
              updateParams({ fundId: e.target.value || null })
            }
          >
            <option value="">All funds</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="giftType">Type</Label>
          <select
            id="giftType"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={searchParams.get("giftType") ?? ""}
            onChange={(e) =>
              updateParams({ giftType: e.target.value || null })
            }
          >
            <option value="">All types</option>
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={searchParams.get("status") ?? ""}
            onChange={(e) =>
              updateParams({ status: e.target.value || null })
            }
          >
            <option value="">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
            <option value="disputed">Disputed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dateFrom">From</Label>
          <Input
            id="dateFrom"
            type="date"
            defaultValue={searchParams.get("dateFrom") ?? ""}
            onChange={(e) =>
              updateParams({ dateFrom: e.target.value || null })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dateTo">To</Label>
          <Input
            id="dateTo"
            type="date"
            defaultValue={searchParams.get("dateTo") ?? ""}
            onChange={(e) =>
              updateParams({ dateTo: e.target.value || null })
            }
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={exportCsv} disabled={pending}>
          Export to CSV
        </Button>
      </div>
    </div>
  );
}
