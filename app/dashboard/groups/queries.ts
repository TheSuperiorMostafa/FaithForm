import type { StaffContext } from "@/lib/groups/staff/context";

/**
 * Small counts for the Groups navigation and the "who will see this" line.
 * Every query names the staff member's own church. A count that fails to load
 * is shown as no badge rather than breaking the page.
 */

export async function groupsNavCounts(ctx: StaffContext): Promise<{ requests: number; reports: number }> {
  try {
    const [requests, reports] = await Promise.all([
      ctx.admin
        .from("group_join_requests")
        .select("id, groups!inner(status)", { count: "exact", head: true })
        .eq("church_id", ctx.churchId)
        .eq("status", "pending")
        .eq("groups.status", "active"),
      ctx.admin
        .from("messaging_reports")
        .select("id", { count: "exact", head: true })
        .eq("church_id", ctx.churchId)
        .eq("status", "open"),
    ]);
    return { requests: requests.count ?? 0, reports: reports.count ?? 0 };
  } catch {
    return { requests: 0, reports: 0 };
  }
}

/** How many of a group's current members are on the app (and so see its chat). */
export async function groupAppReach(ctx: StaffContext, groupId: string): Promise<{ onApp: number; total: number } | null> {
  try {
    const base = () =>
      ctx.admin
        .from("group_memberships")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .eq("church_id", ctx.churchId)
        .eq("status", "active");
    const [total, onApp] = await Promise.all([base(), base().not("account_id", "is", null)]);
    if (total.error || onApp.error) return null;
    return { total: total.count ?? 0, onApp: onApp.count ?? 0 };
  } catch {
    return null;
  }
}
