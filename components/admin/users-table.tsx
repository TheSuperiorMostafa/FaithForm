"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { ManageUserDialog } from "@/components/admin/manage-user-dialog";
import { RoleBadge } from "@/components/admin/badges";
import { Button } from "@/components/ui/button";
import { formatDate, formatRelativeTime } from "@/components/admin/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FeatureKey } from "@/lib/features/catalog";
import type { AdminPlatformUserRow } from "@/lib/queries/admin";

export function UsersTable({
  users,
  featuresByChurch,
}: {
  users: AdminPlatformUserRow[];
  /** Features each church has switched on — the only grantable ones. */
  featuresByChurch: Record<string, FeatureKey[]>;
}) {
  const [role, setRole] = useState("all");
  const [church, setChurch] = useState("all");
  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState<AdminPlatformUserRow | null>(null);

  const churches = useMemo(
    () =>
      Array.from(new Map(users.map((user) => [user.churchId, user.churchName])))
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      if (role !== "all" && user.role !== role) return false;
      if (church !== "all" && user.churchId !== church) return false;
      if (!normalized) return true;
      return (
        (user.email ?? "").toLowerCase().includes(normalized) ||
        user.churchName.toLowerCase().includes(normalized)
      );
    });
  }, [church, query, role, users]);

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[1fr_180px_220px]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email or church..."
        />
        <Select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="viewer">Viewers</option>
        </Select>
        <Select value={church} onChange={(event) => setChurch(event.target.value)}>
          <option value="all">All churches</option>
          {churches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
            <tr>
              <th className="px-5 py-4 text-left">Email</th>
              <th className="px-5 py-4 text-left">Church</th>
              <th className="px-5 py-4 text-left">Role</th>
              <th className="px-5 py-4 text-left">Last sign-in</th>
              <th className="px-5 py-4 text-left">Joined</th>
              <th className="w-px px-5 py-4 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id} className="even:bg-background/60 hover:bg-accent/10">
                <td className="px-5 py-4 font-semibold text-foreground">
                  {user.email ?? "Unknown email"}
                </td>
                <td className="px-5 py-4">
                  <Link
                    href={`/admin/churches/${user.churchId}`}
                    className="hover:text-accent"
                  >
                    {user.churchName}
                  </Link>
                </td>
                <td className="px-5 py-4">
                  <RoleBadge role={user.role} />
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {formatRelativeTime(user.lastSignInAt)}
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {formatDate(user.joinedAt)}
                </td>
                <td className="px-5 py-4 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Manage ${user.email ?? "this user"}`}
                    onClick={() => setManaging(user)}
                  >
                    <MoreHorizontal className="size-4" strokeWidth={1.75} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No users match the selected filters.
        </div>
      )}

      {managing && (
        <ManageUserDialog
          key={managing.id}
          user={managing}
          availableFeatures={featuresByChurch[managing.churchId] ?? []}
          open
          onOpenChange={(next) => {
            if (!next) setManaging(null);
          }}
        />
      )}
    </Card>
  );
}
