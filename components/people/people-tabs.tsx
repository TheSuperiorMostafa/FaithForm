import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

/**
 * People and Families are two views of the same roster. The route keeps its
 * old `/households` address so saved links still work; the words on screen
 * say "Families", which is what a church calls them.
 */
export const PEOPLE_TABS: SectionLinkTab[] = [
  { label: "People", href: "/dashboard/people", match: "exact" },
  { label: "Families", href: "/dashboard/people/households" },
];

/** Page descriptions, shared with the loading skeletons so they match exactly. */
export const PEOPLE_DESCRIPTION =
  "Everyone in your church. Tap a name to see their details or get in touch.";
export const FAMILIES_DESCRIPTION =
  "Put people who live together in a family, so children can be checked in and picked up safely.";

export function PeopleTabs() {
  return <SectionLinkTabs tabs={PEOPLE_TABS} label="People and families" />;
}
