"use client";

import { useId, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { formatGiftDate, plural } from "@/components/giving/giving-page-parts";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InitialsAvatar, List, ListRow } from "@/components/ui/list-row";
import { donorDisplayName } from "@/lib/giving/labels";
import { formatCents } from "@/lib/utils/currency";
import type { GivingDonorRow } from "@/types/giving";

/** Everyone who has given, searchable, each row opening that donor. */
export function DonorsList({ donors }: { donors: GivingDonorRow[] }) {
  const [query, setQuery] = useState("");
  const searchId = useId();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return donors;
    return donors.filter(
      (d) => (d.name ?? "").toLowerCase().includes(q) || d.email.toLowerCase().includes(q),
    );
  }, [donors, query]);

  if (donors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No donors yet"
        description="When someone gives with their name and email, they show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Label htmlFor={searchId} className="sr-only">
          Search donors by name or email
        </Label>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          type="search"
          value={query}
          placeholder="Search by name or email"
          className="min-h-14 rounded-2xl pl-14 text-lg"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <p className="text-[15px] text-muted-foreground" aria-live="polite">
        {query.trim()
          ? `${plural(shown.length, "donor")} found`
          : plural(donors.length, "donor")}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          compact
          icon={Search}
          title="No donors match"
          description="Check the spelling, or search by email address instead."
        />
      ) : (
        <List label="Donors">
          {shown.map((d) => {
            const name = donorDisplayName(d);
            return (
              <ListRow
                key={d.id}
                href={`/dashboard/giving/donors/${d.id}`}
                leading={<InitialsAvatar name={name} />}
                title={name}
                subtitle={
                  d.lastGiftAt
                    ? `Last gift ${formatGiftDate(d.lastGiftAt)} · ${plural(d.giftCount, "gift")} in all`
                    : "No received gifts yet"
                }
                trailing={
                  <span className="text-right">
                    <span className="block font-heading text-lg font-bold text-foreground">
                      {formatCents(d.ytdCents)}
                    </span>
                    <span className="block text-sm text-muted-foreground">this year</span>
                  </span>
                }
              />
            );
          })}
        </List>
      )}
    </div>
  );
}
