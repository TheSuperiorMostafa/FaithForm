import type { ReactNode } from "react";
import { GroupsSectionChrome } from "@/components/groups/sections-chrome";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import { groupsNavCounts } from "../queries";

export const dynamic = "force-dynamic";

/**
 * The header, Create group button and section links for the top-level Groups
 * pages. As a layout it stays mounted while people move between All groups,
 * Messages and Join requests, so only the content below reloads.
 */
export default async function GroupsSectionsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireGroupsStaff();
  const [counts, types, campuses] = await Promise.all([
    groupsNavCounts(ctx),
    groups.listStaffGroupTypes(ctx),
    groups.listStaffCampuses(ctx),
  ]);
  return (
    <GroupsSectionChrome counts={counts} types={types} campuses={campuses}>
      {children}
    </GroupsSectionChrome>
  );
}
