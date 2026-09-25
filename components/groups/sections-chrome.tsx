"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import type { StaffGroupType } from "@/lib/groups/staff/groups";
import { CreateGroupButton } from "./group-form";
import { base, GroupsNav } from "./shared";
import { GROUPS_SECTIONS, type GroupsSection } from "./sections";

const SECTION_BY_SLUG: Record<string, GroupsSection> = {
  "": "list",
  messages: "messages",
  requests: "requests",
  insights: "insights",
  moderation: "moderation",
  settings: "settings",
};

export function groupsSectionFromPath(pathname: string): GroupsSection {
  const slug = pathname.replace(/^\/dashboard\/groups\/?/, "").split("/")[0] ?? "";
  return SECTION_BY_SLUG[slug] ?? "list";
}

/**
 * The page name, its one sentence, the Create group button and the section
 * links for the top-level Groups pages. It lives in the layout, so switching
 * between All groups, Messages and Join requests keeps it in place and only
 * the content below changes.
 */
export function GroupsSectionChrome({
  counts,
  types,
  campuses,
  children,
}: {
  counts: { requests: number; reports: number };
  types: StaffGroupType[];
  campuses: { id: string; name: string }[];
  children: ReactNode;
}) {
  const section = groupsSectionFromPath(usePathname() ?? base);
  const copy = GROUPS_SECTIONS[section];
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={copy.title}
        description={copy.description}
        action={section === "list" ? <CreateGroupButton types={types} campuses={campuses} /> : undefined}
      />
      <GroupsNav requests={counts.requests} reports={counts.reports} />
      {children}
    </div>
  );
}
