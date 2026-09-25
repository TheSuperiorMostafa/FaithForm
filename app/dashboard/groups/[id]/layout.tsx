import type { ReactNode } from "react";
import { GroupDetailShell } from "@/components/groups/group-detail";
import { loadGroup } from "./load";

export const dynamic = "force-dynamic";

/**
 * A group's header, Message group button and tabs. As a layout it stays on
 * screen while people move between Members, Chat and Meetings; only the tab's
 * content reloads.
 */
export default async function GroupLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { detail } = await loadGroup(id);
  return <GroupDetailShell detail={detail}>{children}</GroupDetailShell>;
}
