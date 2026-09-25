/**
 * Copy and links shared by the setup screens, the Home checklist and their
 * loading states. Kept out of the client components so server files (the
 * skeletons, the checklist) read the real strings, not client references.
 */

export const CHURCH_INFO_HREF = "/dashboard/settings?tab=church";
export const TEAM_HREF = "/dashboard/settings?tab=team";
export const CONNECTED_ACCOUNTS_HREF = "/dashboard/settings?tab=accounts";
export const GIVING_HREF = "/dashboard/giving";

export const SETUP_START_TITLE = "Set up your church";
export const SETUP_START_DESCRIPTION =
  "One short form and you're in. You'll be your church's admin.";

/** What the last setup screen suggests next; Home's checklist has the same items. */
export const SETUP_NEXT_STEPS = [
  { key: "serviceTimes", label: "Add your service times" },
  { key: "logo", label: "Add your logo" },
  { key: "team", label: "Invite your team" },
] as const;
