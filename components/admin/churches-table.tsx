"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { resendInvite } from "@/app/onboarding/actions";
import { ConnectedBadge } from "@/components/admin/badges";
import { formatDate, formatRelativeTime } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { AdminChurchListRow } from "@/lib/queries/admin";

type SortKey = "name" | "usersCount" | "sermonsCount" | "lastActiveAt" | "createdAt";

export function ChurchesTable({ churches }: { churches: AdminChurchListRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = churches.filter((church) =>
      church.name.toLowerCase().includes(normalized),
    );

    rows.sort((a, b) => {
      const aValue = a[sortKey] ?? "";
      const bValue = b[sortKey] ?? "";
      const compare =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue));
      return direction === "asc" ? compare : -compare;
    });

    return rows;
  }, [churches, direction, query, sortKey]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection("asc");
  }

  function handleResendInvite(churchId: string) {
    setResendingId(churchId);
    startTransition(async () => {
      const result = await resendInvite(churchId);
      setResendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Invite sent to ${result.email}`);
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Churches</h2>
          <p className="text-sm text-muted-foreground">
            Search and sort every tenant on the platform.
          </p>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search churches..."
          className="sm:max-w-xs"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
            <tr>
              <th className="px-5 py-4 text-left">
                <SortButton onClick={() => toggleSort("name")}>Church</SortButton>
              </th>
              <th className="px-5 py-4 text-left">Onboarding</th>
              <th className="px-5 py-4 text-left">
                <SortButton onClick={() => toggleSort("usersCount")}>Users</SortButton>
              </th>
              <th className="px-5 py-4 text-left">Google</th>
              <th className="px-5 py-4 text-left">Facebook</th>
              <th className="px-5 py-4 text-left">Giving</th>
              <th className="px-5 py-4 text-left">
                <SortButton onClick={() => toggleSort("sermonsCount")}>Sermons</SortButton>
              </th>
              <th className="px-5 py-4 text-left">
                <SortButton onClick={() => toggleSort("lastActiveAt")}>Last active</SortButton>
              </th>
              <th className="px-5 py-4 text-left">
                <SortButton onClick={() => toggleSort("createdAt")}>Joined</SortButton>
              </th>
              <th className="px-5 py-4 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((church) => (
              <tr key={church.id} className="even:bg-background/60 hover:bg-accent/10">
                <td className="px-5 py-4 font-semibold text-foreground">
                  <Link href={`/admin/churches/${church.id}`} className="hover:text-accent">
                    {church.name}
                  </Link>
                </td>
                <td className="px-5 py-4">
                  <OnboardingBadge completedAt={church.onboardingCompletedAt} />
                </td>
                <td className="px-5 py-4">{church.usersCount}</td>
                <td className="px-5 py-4">
                  <ConnectedBadge connected={church.googleConnected} />
                </td>
                <td className="px-5 py-4">
                  <ConnectedBadge connected={church.facebookConnected} />
                </td>
                <td className="px-5 py-4">
                  <GivingStatusBadge
                    status={church.stripeOnboardingStatus}
                    live={church.stripeChargesEnabled}
                  />
                </td>
                <td className="px-5 py-4">{church.sermonsCount}</td>
                <td className="px-5 py-4 text-muted-foreground">
                  {formatRelativeTime(church.lastActiveAt)}
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {formatDate(church.createdAt)}
                </td>
                <td className="px-5 py-4">
                  {!church.onboardingCompletedAt &&
                    (church.pendingInviteEmail ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            disabled={resendingId === church.id}
                            onSelect={() => handleResendInvite(church.id)}
                          >
                            {resendingId === church.id ? "Sending…" : "Resend Invite"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      // Nothing to resend: this church was created for us to set
                      // up, and is still waiting on an address to hand over to.
                      <Link
                        href={`/admin/churches/${church.id}?tab=users`}
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        Invite admin
                      </Link>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No churches match your search.
        </div>
      )}
    </Card>
  );
}

function OnboardingBadge({ completedAt }: { completedAt: string | null }) {
  if (completedAt) {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent dark:text-[#EBAA5F]">
      Pending Setup
    </span>
  );
}

function GivingStatusBadge({
  status,
  live,
}: {
  status: string;
  live: boolean;
}) {
  if (live) {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Live
      </span>
    );
  }
  const label =
    status === "restricted"
      ? "Restricted"
      : status === "pending"
        ? "Pending"
        : status === "deauthorized"
          ? "Off"
          : "Not set up";
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function SortButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-ml-2 h-auto min-h-0 px-2 py-1 text-xs uppercase tracking-wide text-primary-foreground hover:bg-white/10 hover:text-white dark:text-secondary-foreground dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
      <ArrowUpDown className="size-3" />
    </Button>
  );
}
