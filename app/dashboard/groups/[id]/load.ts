import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { VisitorError } from "@/lib/faithform/errors";
import { isUuid } from "@/lib/groups/context";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";

/**
 * One group, loaded once per request and shared by the group's layout (header
 * and tabs) and whichever tab page is showing.
 */
export const loadGroup = cache(async (id: string) => {
  if (!isUuid(id)) notFound();
  const ctx = await requireGroupsStaff();
  try {
    const detail = await groups.getStaffGroup(ctx, id);
    return { ctx, detail };
  } catch (error) {
    if (error instanceof VisitorError && error.code === "group_not_found") notFound();
    throw error;
  }
});
