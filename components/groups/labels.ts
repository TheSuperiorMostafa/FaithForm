/**
 * Plain words for the Groups dashboard. Every value a church sees comes from
 * here, so the list, the group header and the settings form never disagree
 * (and never show a raw database value like `approval_required`).
 *
 * Pure functions only: no React, no imports, so they are unit-testable.
 */

export const VISIBILITY_LABELS = {
  public: "Anyone in the church",
  unlisted: "People with a link",
  private: "Group members only",
} as const;

export const ENROLLMENT_LABELS = {
  open: "Join right away",
  approval_required: "Ask to join",
  invitation_only: "Invitation only",
  closed: "Not taking new people",
} as const;

export const ROLE_LABELS = {
  member: "Member",
  leader: "Leader",
  manager: "Manager",
} as const;

export const ROLE_HINTS = {
  member: "Takes part in the group",
  leader: "Leads meetings, takes attendance and looks after the chat",
  manager: "Everything a leader can do, plus the group's settings and leaders",
} as const;

export const REPORT_REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Bullying or harassment",
  hate: "Hateful words",
  sexual: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Someone may be at risk of self-harm",
  inappropriate: "Not appropriate",
  other: "Something else",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Needs review",
  resolved: "Handled",
  dismissed: "No action needed",
};

export const CATEGORY_ICON_LABELS: Record<string, string> = {
  users: "People",
  book: "Book",
  sparkles: "Sparkles",
  user: "Person",
  heart: "Heart",
  graduation: "Graduation cap",
  hands: "Helping hands",
  music: "Music",
  briefcase: "Briefcase",
  school: "School",
  prayer: "Prayer",
  church: "Church",
  star: "Star",
  coffee: "Coffee",
  baby: "Baby",
  globe: "Globe",
  compass: "Compass",
  leaf: "Leaf",
};

function lookup<T extends Record<string, string>>(labels: T, value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return (labels as Record<string, string>)[value] ?? fallback;
}

export const visibilityLabel = (value: string | null | undefined) => lookup(VISIBILITY_LABELS, value, "Anyone in the church");
export const enrollmentLabel = (value: string | null | undefined) => lookup(ENROLLMENT_LABELS, value, "Join right away");
export const roleLabel = (value: string | null | undefined) => lookup(ROLE_LABELS, value, "Member");
export const reportReasonLabel = (value: string | null | undefined) => lookup(REPORT_REASON_LABELS, value, "Something else");
export const reportStatusLabel = (value: string | null | undefined) => lookup(REPORT_STATUS_LABELS, value, "Handled");
export const categoryIconLabel = (value: string | null | undefined) => lookup(CATEGORY_ICON_LABELS, value, "People");

/** Group status in the canonical words: Active or Archived. */
export function groupStatusLabel(status: string): string {
  return status === "archived" ? "Archived" : status === "deleted" ? "Deleted" : "Active";
}

/**
 * The server's defaults for a brand-new group (the same values the old
 * create form pre-selected). The quick create flow sends exactly these unless
 * the person changes them under "More options".
 */
export const NEW_GROUP_DEFAULTS = {
  visibility: "public",
  enrollment: "open",
  locationVisibility: "members",
  chatEnabled: true,
  chatPosting: "everyone",
  allowMemberMedia: true,
  allowMemberLinks: true,
  memberListVisibility: "members",
  safetyProfile: "standard",
  defaultNotificationLevel: "all",
} as const;

/**
 * Does this category name suggest a group for children or teenagers? Used to
 * ask the youth-protection question plainly instead of leaving it buried.
 */
export function categoryImpliesYouth(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\b(youth|teens?|teenagers?|students?|kids?|children|child|juniors?|middle school|high school|confirmation|vbs)\b/i.test(name);
}

export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** "Choir created with 8 people." / "Choir created." */
export function createdMessage(name: string, added: number): string {
  return added > 0 ? `${name} created with ${peopleCount(added)}.` : `${name} created.`;
}

/** "Add 3 people" / "Add 1 person" / "Add people". */
export function addPeopleLabel(count: number): string {
  return count > 0 ? `Add ${peopleCount(count)}` : "Add people";
}

/** "Maria added to Choir." / "3 people added to Choir." */
export function addedMessage(groupName: string, added: number, names: string[] = []): string {
  if (added <= 0) return `Everyone you chose is already in ${groupName}.`;
  if (added === 1 && names.length === 1) return `${names[0]} added to ${groupName}.`;
  return `${peopleCount(added)} added to ${groupName}.`;
}

/**
 * The capacity problem, said plainly, or null when everyone fits. Never
 * offers to "add them anyway": the dashboard has no such option.
 */
export function capacityProblem(capacity: number | null, current: number, adding: number): string | null {
  if (capacity === null || adding <= 0) return null;
  const left = Math.max(0, capacity - current);
  if (adding <= left) return null;
  if (left === 0) return "This group is full. Raise its size in Group settings before adding more people.";
  return `Only ${left} more ${left === 1 ? "person fits" : "people fit"} in this group. Choose fewer people, or raise its size in Group settings.`;
}

/** Who a group message reaches, in one sentence. */
export function reachSentence(onApp: number, total: number): string {
  if (total === 0) return "No one is in this group yet. Add people so there is someone to talk to.";
  if (onApp === total) return `All ${peopleCount(total)} in this group are on the app and will see it.`;
  if (onApp === 0) return `None of the ${peopleCount(total)} in this group are on the app yet, so no one will see it until they join.`;
  const missing = total - onApp;
  return `${onApp} of ${total} people will see it. ${peopleCount(missing)} ${missing === 1 ? "isn’t" : "aren’t"} on the app yet.`;
}
